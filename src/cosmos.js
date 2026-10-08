import * as THREE from 'three';

/* Весь «космос» сайта: туманность, звёзды, пыль, луна, звезда-солнце. Шейдеры написаны так, чтобы
   выглядеть одинаково и с постобработкой (RenderTarget), и без неё (прямо на экран). */

const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export const NOISE = /* glsl */ `
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)),hash13(i+vec3(1,0,0)),f.x),
                 mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),
                 mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
float fbm3(vec3 p){ float a=.5,s=0.; for(int i=0;i<3;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
`;

/* ── текстуры-спрайты ─────────────────────────────────────────────── */

export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.38)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Звезда с дифракционными лучами — маркер вкуса на орбите. */
export function glintTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[S, 5], [5, S]]) {
    const lg = w > h ? x.createLinearGradient(0, 0, S, 0) : x.createLinearGradient(0, 0, 0, S);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = lg;
    x.fillRect(S / 2 - w / 2, S / 2 - h / 2, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── туманность ───────────────────────────────────────────────────── */

export function makeNebula() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uTint: { value: new THREE.Color('#e9c871') },
        uTint2: { value: new THREE.Color('#6a5cff') },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1., 1.); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uScroll; uniform vec3 uTint; uniform vec3 uTint2; uniform vec2 uRes;
        varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 uv = vUv*2.-1.; uv.x *= uRes.x/uRes.y;
          vec3 p = vec3(uv*1.1, uTime*.016 + uScroll*.7);
          float w = fbm(p*.7 + 3.0);
          float n = fbm(p + vec3(w*1.6, w*1.2, 0.));
          float m = smoothstep(.36,.9,n);
          float m2 = smoothstep(.42,.95, fbm(p*1.3 + 11.0));
          vec3 col = vec3(.010,.010,.015);
          col += uTint * m * .17;
          col += mix(uTint, uTint2, .65) * m2 * .07;
          col += vec3(.5,.38,.16) * pow(fbm(p*.5 + 9.), 3.) * .12;
          float vig = dot(vUv-.5, vUv-.5);
          col *= 1. - 1.3*vig;
          gl_FragColor = vec4(col, 1.);
          ${OUT}
        }`,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/* ── звёздное поле ────────────────────────────────────────────────── */

export function makeStars(count, pr) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const palette = [new THREE.Color('#d6e0ff'), new THREE.Color('#ffffff'), new THREE.Color('#ffe6a8'), new THREE.Color('#e9c871')];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 150;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 95;
    pos[i * 3 + 2] = 24 - Math.random() * 300;
    size[i] = Math.random() ** 3 * 2.4 + 0.5;
    seed[i] = Math.random();
    const c = palette[Math.floor(Math.random() ** 1.6 * palette.length)];
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: pr } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aSeed; attribute vec3 aCol;
      uniform float uTime; uniform float uPR; varying vec3 vCol; varying float vTw;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.);
        gl_Position = projectionMatrix * mv;
        vTw = .55 + .45*sin(uTime*(.6+aSeed*1.8) + aSeed*40.);
        gl_PointSize = clamp(aSize * uPR * (150. / max(-mv.z, .5)), 0., 16.*uPR);
        vCol = aCol;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vTw;
      void main(){
        float d = length(gl_PointCoord - .5);
        float a = pow(smoothstep(.5, 0., d), 2.2);
        gl_FragColor = vec4(vCol * vTw, a * vTw);
        ${OUT}
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat };
}

/* ── боке-пыль перед камерой: даёт глубину резкости ─────────────── */

export function makeDust(count, pr) {
  const RANGE = 15;
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 20;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 11;
    pos[i * 3 + 2] = -Math.random() * RANGE;
    size[i] = 10 + Math.random() ** 2 * 46;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uPR: { value: pr }, uOffset: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uTint: { value: new THREE.Color('#e9c871') },
    },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aSeed;
      uniform float uTime; uniform float uPR; uniform float uOffset; uniform vec2 uRes;
      varying float vA; varying float vS;
      void main(){
        vec3 p = position;
        p.z = -mod(-p.z + uOffset, ${RANGE.toFixed(1)});
        p.x += sin(uTime*.12 + aSeed*30.) * .35;
        p.y += cos(uTime*.1 + aSeed*20.) * .25;
        vec4 mv = modelViewMatrix * vec4(p,1.);
        gl_Position = projectionMatrix * mv;
        float depth = -mv.z;
        float fade = smoothstep(0., 2.5, depth) * (1. - smoothstep(${(RANGE - 3).toFixed(1)}, ${RANGE.toFixed(1)}, depth));
        vA = fade * (.05 + aSeed*.11);
        vS = aSeed;
        gl_PointSize = clamp(aSize * uPR * (uRes.y/1080.) * (8. / max(depth, .5)), 0., 220.*uPR);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; varying float vA; varying float vS;
      void main(){
        float d = length(gl_PointCoord - .5) * 2.;
        float disc = smoothstep(1., .82, d);
        float ring = smoothstep(.55, .95, d) * smoothstep(1., .9, d);
        float a = (disc * .35 + ring * .65) * vA;
        vec3 c = mix(vec3(1.), uTint, .5 + .4*vS);
        gl_FragColor = vec4(c * a, a);
        ${OUT}
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 20;
  return { points, mat };
}

/* ── луна / планета ───────────────────────────────────────────────── */

export function makeMoon({ detail = true } = {}) {
  const uniforms = {
    uAlpha: { value: 1 },
    uRim: { value: new THREE.Color('#e9c871') },
    uLight: { value: new THREE.Vector3(0.6, 0.45, -0.4).normalize() },
    uBump: { value: 1.3 },
    uTime: { value: 0 },
    uSeed: { value: Math.random() * 20 },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main(){
        vP = position;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha; uniform vec3 uRim; uniform vec3 uLight; uniform float uBump; uniform float uSeed;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      ${NOISE}
      // кратеры: сумма «чаша + вал» по ячейкам; высота в долях радиуса луны
      float craters(vec3 p, float scale, float depth){
        vec3 q = p*scale + uSeed;
        vec3 i = floor(q); vec3 f = fract(q);
        float h = 0.;
        for (int z=-1; z<=1; z++) for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++){
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = hash33(i+g);
          vec3 d = g + o - f;
          float rad = mix(.22, .46, hash13(i+g+7.7));
          float t = length(d) / rad;
          float bowl = (1. - t*t) * step(t, 1.);
          float rim = exp(-pow((t-1.05)*5., 2.));
          h += (-bowl * .8 + rim * .35) * depth * rad;
        }
        return h / scale;
      }
      vec3 perturb(vec3 n, vec3 pos, float h, float k){
        vec3 dpx = dFdx(pos); vec3 dpy = dFdy(pos);
        float dhx = dFdx(h); float dhy = dFdy(h);
        vec3 r1 = cross(dpy, n); vec3 r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dhx*r1 + dhy*r2);
        return normalize(abs(det)*n - k*grad);
      }
      void main(){
        vec3 n0 = normalize(vN);
        vec3 v = normalize(vV);
        float h = fbm3(vP*2.2 + uSeed) * .03;
        h += craters(vP, 4.5, .36);
        ${detail ? 'h += craters(vP, 10.5, .34);' : ''}
        vec3 n = perturb(n0, -vV, h, uBump);
        float ndl = dot(n, uLight);
        float lit = smoothstep(-.05, .62, ndl);
        float maria = smoothstep(.42, .64, fbm3(vP*1.3 + uSeed*1.7));
        float tone = clamp(.55 + h*16., 0., 1.) * (1. - .38*maria);
        vec3 albedo = mix(vec3(.05,.05,.055), vec3(.2,.195,.185), tone);
        vec3 col = albedo * (lit*1.5 + max(dot(n, normalize(vec3(-.55,.25,.8))),0.)*.12 + .03);
        float fres = pow(1. - max(dot(n0, v), 0.), 3.0);
        float edgeLit = smoothstep(-.15, .85, dot(n0, uLight));
        col += uRim * fres * (.06 + 1.5*edgeLit);
        gl_FragColor = vec4(col, uAlpha);
        ${OUT}
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), material);
  mesh.frustumCulled = false;

  // атмосфера — светящийся ореол по краю
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uAlpha: uniforms.uAlpha, uRim: uniforms.uRim, uLight: uniforms.uLight,
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha; uniform vec3 uRim; uniform vec3 uLight;
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(vV);
        // задняя грань оболочки: чем ближе к краю луны, тем ярче; наружу плавно гаснет
        float c = pow(clamp(abs(dot(n, v)), 0., 1.), 1.5);
        float lit = smoothstep(-.25, .7, dot(n, uLight));
        vec3 col = uRim * c * (.03 + 2.1*lit);
        gl_FragColor = vec4(col, c * (.1 + lit) * uAlpha);
        ${OUT}
      }`,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.14, 96, 64), atmoMat);
  atmo.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh, atmo);
  return { group, uniforms };
}

/* ── звезда-солнце: ядро с грануляцией, корона и анаморфный блик ──── */

export function makeStar({ detail = true } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uHot: { value: new THREE.Color('#ffd98a') },
    uCool: { value: new THREE.Color('#a84a10') },
    uK: { value: 1 },
  };
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.ShaderMaterial({
      // аддитивное смешивание: при угасании звезда растворяется, а не превращается в чёрный диск
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP; varying vec3 vV;
        void main(){
          vP = position; vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.); vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uHot; uniform vec3 uCool; uniform float uK;
        varying vec3 vN; varying vec3 vP; varying vec3 vV;
        ${NOISE}
        void main(){
          vec3 n = normalize(vN); vec3 v = normalize(vV);
          float ndv = clamp(dot(n, v), 0., 1.);
          float t = uTime * .05;
          float g = fbm(vP*5. + vec3(0., t, t*.6));
          ${detail ? 'float g2 = fbm(vP*13. - vec3(t*1.7, 0., t)); g = mix(g, g2, .45);' : ''}
          float limb = pow(ndv, .5);
          float cells = smoothstep(.3, .8, g);
          vec3 base = mix(uCool, uHot, .3 + cells * .7);
          vec3 col = base * (.3 + .62*limb);
          col = mix(col, vec3(1.), pow(ndv, 5.) * .06);
          col += uHot * pow(1. - ndv, 3.5) * .28;
          col *= uK;
          gl_FragColor = vec4(col, 1.);
          ${OUT}
        }`,
    }),
  );
  core.frustumCulled = false;

  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uHot; uniform float uK;
        varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 p = (vUv - .5) * 2.;
          float r = length(p);
          float a = atan(p.y, p.x);
          float glow = pow(max(0., 1. - r), 2.4);
          float halo = pow(max(0., 1. - r), 5.5);
          float rays = fbm3(vec3(cos(a)*2.4, sin(a)*2.4, uTime*.05 + r*1.2));
          rays = pow(rays, 2.2) * 2.4;
          vec3 c = uHot * (glow * (.8 + rays*1.2) + halo * 1.9) * uK;
          gl_FragColor = vec4(c, (glow + halo) * .7);
          ${OUT}
        }`,
    }),
  );
  corona.frustumCulled = false;

  const streak = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: /* glsl */ `
        uniform vec3 uHot; uniform float uK;
        varying vec2 vUv;
        void main(){
          float x = abs(vUv.x - .5) * 2.; float y = abs(vUv.y - .5) * 2.;
          float s = pow(1. - x, 3.2) * pow(1. - y, 9.);
          gl_FragColor = vec4(uHot * s * 1.1 * uK, s * .5);
          ${OUT}
        }`,
    }),
  );
  streak.frustumCulled = false;

  const group = new THREE.Group();
  group.add(corona, core, streak);
  return { group, core, corona, streak, uniforms };
}

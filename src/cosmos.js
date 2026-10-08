import * as THREE from 'three';

/* «Космос» сайта: туманность, звёзды, луна и звезда-солнце. Шейдеры подключают tonemapping и colorspace сами,
   потому что сцена рисуется прямо на экран (без постобработки): так нет промежуточных буферов и лишней памяти. */

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

/** Чёткая маленькая точка: маркер звезды на орбите. */
export function dotTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.62, 'rgba(255,255,255,1)');
  g.addColorStop(0.72, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── туманность ───────────────────────────────────────────────────── */

/**
 * Туманность мягкая и низкочастотная, поэтому считается в маленький буфер (около половины экрана по ширине),
 * а на экран выводится обычным текстурированным прямоугольником. Это в десятки раз дешевле, чем шум на каждый
 * пиксель в полном разрешении, и именно такие тяжёлые полноэкранные шейдеры вешают слабые видеокарты.
 */
export function makeNebula() {
  const source = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uTint: { value: new THREE.Color('#cdac62') },
      uTint2: { value: new THREE.Color('#5a52c8') },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1., 1.); }',
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uScroll; uniform vec3 uTint; uniform vec3 uTint2; uniform vec2 uRes;
      varying vec2 vUv;
      ${NOISE}
      void main(){
        vec2 uv = vUv*2.-1.; uv.x *= uRes.x/uRes.y;
        vec3 p = vec3(uv*1.1, uTime*.014 + uScroll*.6);
        float w = fbm(p*.7 + 3.0);
        float n = fbm(p + vec3(w*1.6, w*1.2, 0.));
        float m = smoothstep(.38,.92,n);
        float m2 = smoothstep(.42,.95, fbm(p*1.3 + 11.0));
        vec3 col = vec3(.014,.014,.018);
        col += uTint * m * .11;
        col += mix(uTint, uTint2, .65) * m2 * .035;
        float vig = dot(vUv-.5, vUv-.5);
        col *= 1. - 1.6*vig;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const srcScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), source);
  quad.frustumCulled = false;
  srcScene.add(quad);
  const srcCam = new THREE.Camera();
  // HalfFloat: в тёмных градиентах 8 бит дали бы заметные ступени
  const rt = new THREE.WebGLRenderTarget(640, 360, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: { tNeb: { value: rt.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1., 1.); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tNeb; varying vec2 vUv;
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main(){
          gl_FragColor = vec4(texture2D(tNeb, vUv).rgb, 1.);
          ${OUT}
          // дизеринг уже в итоговом цвете: убирает ступени в тёмных градиентах
          gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - .5) / 255.;
        }`,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  return {
    mesh,
    uniforms: source.uniforms,
    render(renderer) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(srcScene, srcCam);
      renderer.setRenderTarget(prev);
    },
    setSize(w, h, scale) {
      source.uniforms.uRes.value.set(w, h);
      rt.setSize(Math.max(64, Math.round(w * scale)), Math.max(64, Math.round(h * scale)));
    },
  };
}

/* ── звёздное поле ────────────────────────────────────────────────── */

export function makeStars(count, pr) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const palette = [new THREE.Color('#d6e0ff'), new THREE.Color('#ffffff'), new THREE.Color('#ffe6a8'), new THREE.Color('#cdac62')];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 150;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 95;
    pos[i * 3 + 2] = 24 - Math.random() * 300;
    size[i] = Math.random() ** 3 * 2.2 + 0.5;
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
        vTw = .6 + .4*sin(uTime*(.5+aSeed*1.4) + aSeed*40.);
        gl_PointSize = clamp(aSize * uPR * (150. / max(-mv.z, .5)), 0., 14.*uPR);
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

/* ── луна ─────────────────────────────────────────────────────────── */

// Фото луны (src/assets/moon.jpg, диск вырезан по кругу) проецируется на сферу, обращённую к камере.
// Видна только ближняя сторона, поэтому «вращение» это либрация: покачивание в пределах нескольких градусов
// (как у настоящей луны, всегда повёрнутой одной стороной), плюс небольшой доворот при прокрутке (uYaw).
// Освещение запечено в снимке; шейдер добавляет золотую кайму и гасит луну по uAlpha.
export function makeMoon(url, maxAniso = 8) {
  const map = new THREE.TextureLoader().load(url);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  const uniforms = {
    uMap: { value: map },
    uAlpha: { value: 1 },
    uRim: { value: new THREE.Color('#cdac62') },
    uLight: { value: new THREE.Vector3(0.6, 0.45, -0.4).normalize() },
    uYaw: { value: 0 },
    uPitch: { value: 0 },
    uDetail: { value: 1 },
    uGain: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        vP = position;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uAlpha; uniform vec3 uRim; uniform vec3 uLight; uniform float uGain; uniform float uYaw; uniform float uPitch;
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vP);
        float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
        n = vec3(cy*n.x + sy*n.z, n.y, -sy*n.x + cy*n.z);
        n = vec3(n.x, cp*n.y - sp*n.z, sp*n.y + cp*n.z);
        // за пределом снимка (край, довёрнутый от камеры) берём кромку диска: полоса в 1-2% радиуса
        vec2 q = n.xy;
        float rr = length(q);
        if (rr > .985) q *= .985 / rr;
        vec3 tex = texture2D(uMap, .5 + q * .5 * .9956).rgb;
        vec3 col = tex * vec3(1.04, 1., .93) * .9;
        vec3 n0 = normalize(vN);
        vec3 v = normalize(vV);
        float ndv = max(dot(n0, v), 0.);
        float edgeLit = smoothstep(-.15, .85, dot(n0, uLight));
        col += uRim * pow(1. - ndv, 3.) * (.04 + .55 * edgeLit);
        gl_FragColor = vec4(col * uGain, uAlpha);
        ${OUT}
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), material);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, uniforms };
}

/* ── звезда-солнце: ядро с грануляцией и мягкая корона ────────────── */

export function makeStar() {
  const uniforms = {
    uTime: { value: 0 },
    uHot: { value: new THREE.Color('#ffd98a') },
    uCool: { value: new THREE.Color('#a84a10') },
    uK: { value: 1 },
    uDetail: { value: 1 },
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
        uniform float uTime; uniform vec3 uHot; uniform vec3 uCool; uniform float uK; uniform float uDetail;
        varying vec3 vN; varying vec3 vP; varying vec3 vV;
        ${NOISE}
        void main(){
          vec3 n = normalize(vN); vec3 v = normalize(vV);
          float ndv = clamp(dot(n, v), 0., 1.);
          float t = uTime * .05;
          float g = fbm(vP*5. + vec3(0., t, t*.6));
          if (uDetail > .5) { float g2 = fbm(vP*13. - vec3(t*1.7, 0., t)); g = mix(g, g2, .45); }
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
          float glow = pow(max(0., 1. - r), 2.6);
          float halo = pow(max(0., 1. - r), 6.);
          float rays = fbm3(vec3(cos(a)*2.4, sin(a)*2.4, uTime*.04 + r*1.2));
          rays = pow(rays, 2.2) * 2.2;
          vec3 c = uHot * (glow * (.55 + rays*.7) + halo * 1.2) * uK;
          gl_FragColor = vec4(c, (glow + halo) * .6);
          ${OUT}
        }`,
    }),
  );
  corona.frustumCulled = false;

  const group = new THREE.Group();
  group.add(corona, core);
  return { group, core, corona, uniforms };
}

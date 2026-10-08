import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FLAVORS } from './data.js';
import { createJar } from './jar.js';

const NOISE = /* glsl */ `
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePlanet(gain = 1) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uAlpha: { value: 1 },
      uRim: { value: new THREE.Color('#e9c871') },
      uLight: { value: new THREE.Vector3(-0.7, 0.55, 0.5).normalize() },
      uTime: { value: 0 },
      uGain: { value: gain },
    },
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
      uniform float uAlpha; uniform vec3 uRim; uniform vec3 uLight; uniform float uTime; uniform float uGain;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      ${NOISE}
      void main(){
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float h = fbm(vP*4.6 + 7.0);
        float craters = smoothstep(.40,.62,fbm(vP*11.0));
        float surf = mix(h, craters, .6);
        vec3 albedo = mix(vec3(.018,.018,.022), vec3(.115,.112,.115), surf);
        float ndl = max(dot(n, uLight), 0.);
        float diff = pow(ndl, 1.1);
        float fres = pow(1. - max(dot(n, v), 0.), 3.2);
        float lit = smoothstep(-.35, .7, dot(n, uLight));
        vec3 col = albedo * (diff*1.5 + .06);
        col += uRim * fres * (.1 + .85*lit);
        gl_FragColor = vec4(col * uGain, uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
  m.frustumCulled = false;
  return m;
}

export async function createScene(canvas, { lowPower }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: lowPower, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 1.75);
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  scene.add(camera);

  // ── туманность на фоне ─────────────────────────────────────────────
  const nebula = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uTint: { value: new THREE.Color('#e9c871') },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1., 1.); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uScroll; uniform vec3 uTint; uniform vec2 uRes;
        varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 uv = vUv*2.-1.; uv.x *= uRes.x/uRes.y;
          vec3 p = vec3(uv*1.15, uTime*.018 + uScroll*.6);
          float n = fbm(p + fbm(p*1.7 + 3.0));
          float m = smoothstep(.38,.92,n);
          vec3 col = vec3(.012,.012,.017);
          col += uTint * m * .2;
          col += vec3(.5,.38,.16) * pow(fbm(p*.55+9.), 3.) * .14;
          float vig = dot(vUv-.5, vUv-.5);
          col *= 1. - 1.35*vig;
          gl_FragColor = vec4(col, 1.);
          #include <colorspace_fragment>
        }`,
    }),
  );
  nebula.frustumCulled = false;
  nebula.renderOrder = -10;
  scene.add(nebula);

  // ── звёзды ────────────────────────────────────────────────────────
  const N = lowPower ? 3500 : 7500;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const seed = new Float32Array(N);
  const col = new Float32Array(N * 3);
  const palette = [new THREE.Color('#d6e0ff'), new THREE.Color('#ffffff'), new THREE.Color('#ffe6a8'), new THREE.Color('#e9c871')];
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 150;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 95;
    pos[i * 3 + 2] = 24 - Math.random() * 300;
    size[i] = Math.random() ** 3 * 2.4 + 0.5;
    seed[i] = Math.random();
    const c = palette[Math.floor(Math.random() ** 1.6 * palette.length)];
    col.set([c.r, c.g, c.b], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  starGeo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const starMat = new THREE.ShaderMaterial({
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
        #include <colorspace_fragment>
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // ── объекты, привязанные к камере (камера летит сквозь звёзды) ───────
  const rigCam = new THREE.Group();
  camera.add(rigCam);

  const key = new THREE.DirectionalLight(0xfff1d0, 0.55);
  key.position.set(-3, 4, 2);
  const rim = new THREE.DirectionalLight(0xe9c871, 0.8);
  rim.position.set(4, 1, -3);
  rigCam.add(key, rim);

  const planetGain = lowPower ? 0.5 : 1; // без постобработки (ACES) шейдер выглядит светлее
  const heroPlanet = makePlanet(planetGain);
  rigCam.add(heroPlanet);
  const horizon = makePlanet(planetGain);
  rigCam.add(horizon);

  const jar = createJar();
  rigCam.add(jar.rig);

  // кольцо звёзд-вкусов вокруг банки
  const ringHost = new THREE.Group();
  const ringTilt = new THREE.Group();
  const ring = new THREE.Group();
  ringHost.add(ringTilt);
  ringTilt.add(ring);
  rigCam.add(ringHost);
  const glow = glowTexture();
  const orbs = FLAVORS.map((f, i) => {
    const g = new THREE.Group();
    const a = (i / FLAVORS.length) * Math.PI * 2;
    g.position.set(Math.sin(a) * 2.6, 0, Math.cos(a) * 2.6);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 32, 16),
      new THREE.MeshStandardMaterial({ color: f.b, emissive: f.a, emissiveIntensity: 0.9, roughness: 0.5 }),
    );
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: f.a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55,
    }));
    halo.scale.setScalar(0.5);
    g.add(mesh, halo);
    ring.add(g);
    return { g, mesh, halo };
  });
  ringTilt.rotation.x = 0.5;
  ringTilt.rotation.z = -0.12;

  // ── постобработка ─────────────────────────────────────────────────
  let composer = null;
  let bloom = null;
  if (!lowPower) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.6, 0.93);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    nebula.material.uniforms.uRes.value.set(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  /** s — сглаженное состояние, посчитанное в main.js */
  function update(s) {
    const { time } = s;
    camera.position.z = 6 - s.fly * 200;
    camera.rotation.y = -s.px * 0.05;
    camera.rotation.x = s.py * 0.035;
    const fov = 40 + s.warp * 16;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    bloom && (bloom.strength = 0.3 + s.warp * 0.5);

    nebula.material.uniforms.uTime.value = time;
    nebula.material.uniforms.uScroll.value = s.fly;
    nebula.material.uniforms.uTint.value.copy(s.tint);
    starMat.uniforms.uTime.value = time;
    stars.rotation.z = time * 0.004 + s.fly * 0.3;

    // планета в хиро
    heroPlanet.position.set(s.planet.x, s.planet.y, s.planet.z);
    heroPlanet.scale.setScalar(s.planet.s);
    heroPlanet.material.uniforms.uAlpha.value = s.planet.a;
    heroPlanet.material.uniforms.uRim.value.copy(s.tint);
    heroPlanet.visible = s.planet.a > 0.005;
    heroPlanet.rotation.y = time * 0.01;

    horizon.position.set(0, s.horizon.y, s.horizon.z);
    horizon.scale.setScalar(s.horizon.s);
    horizon.material.uniforms.uAlpha.value = s.horizon.a;
    horizon.material.uniforms.uRim.value.copy(s.tint);
    horizon.visible = s.horizon.a > 0.005;

    // банка
    const j = s.jar;
    jar.rig.visible = j.vis;
    jar.rig.position.set(j.x, j.y + Math.sin(time * 0.9) * 0.05, -6.6);
    jar.rig.scale.setScalar(j.s);
    jar.rig.rotation.set(j.rx, 0, j.rz);
    jar.spin.rotation.y = j.ry;

    // кольцо вкусов
    ringHost.visible = s.ring.vis > 0.01;
    ringHost.position.set(j.x, j.y, -6.6);
    ringHost.scale.setScalar(Math.max(0.001, s.ring.vis) * j.s * 0.8);
    ring.rotation.y = s.ring.rot;
    orbs.forEach((o, i) => {
      const on = i === s.ring.active;
      const k = on ? 1.8 : 1.0;
      o.mesh.scale.lerp(tmp3.set(k, k, k), 0.12);
      o.halo.scale.setScalar(THREE.MathUtils.lerp(o.halo.scale.x, on ? 1.3 : 0.5, 0.12));
      o.halo.material.opacity = THREE.MathUtils.lerp(o.halo.material.opacity, on ? 0.9 : 0.4, 0.12);
    });

    (composer || { render: () => renderer.render(scene, camera) }).render();
  }
  const tmp3 = new THREE.Vector3();

  return { renderer, jar, update, resize };
}

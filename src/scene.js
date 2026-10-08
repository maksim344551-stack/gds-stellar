import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FLAVORS } from './data.js';
import { createJar } from './jar.js';
import { createFXPass } from './fx.js';
import { glintTexture, glowTexture, makeDust, makeMoon, makeNebula, makeStar, makeStars } from './cosmos.js';

const RING_R = 2.6;

/** Студийное освещение: тёмная комната с софтбоксами — даёт хрому чёткие, «рекламные» блики. */
function studioEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x0c0d11);
  const box = (color, k, w, h, dir, dist = 12) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(...dir).normalize().multiplyScalar(dist);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  box('#fff0d8', 8, 9, 7, [-0.7, 0.75, 0.55]); // основной мягкий источник сверху-слева
  box('#9cc3ff', 6, 2.2, 11, [1, 0.15, 0.35]); // холодная вертикальная полоса справа
  box('#ffffff', 5, 14, 1.6, [0, 1, 0.1]); // верхняя полоса
  box('#e9c871', 6, 6, 9, [0.65, 0.2, -1]); // золотой контровой сзади-справа
  box('#ffd9a0', 3, 7, 4, [-1, -0.2, -0.4]); // тёплый контровой сзади-слева
  box('#1b1d24', 1.2, 16, 16, [0, -1, 0]); // пол — слабый отсвет
  const tex = pm.fromScene(env, 0.025).texture;
  pm.dispose();
  return tex;
}

export async function createScene(canvas, { lowPower, quality: forced }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: lowPower, powerPreference: 'high-performance' });
  const maxPR = lowPower ? 1.5 : 1.75;
  let pr = Math.min(window.devicePixelRatio || 1, maxPR);
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  scene.add(camera);

  const nebula = makeNebula();
  scene.add(nebula);
  const stars = makeStars(lowPower ? 3500 : 7500, pr);
  stars.points.renderOrder = 5;
  scene.add(stars.points);

  // всё, что привязано к камере (камера летит сквозь звёзды, а кадр остаётся стабильным)
  const rigCam = new THREE.Group();
  camera.add(rigCam);

  const key = new THREE.DirectionalLight(0xfff1d0, 0.45);
  key.position.set(-3, 4, 2);
  const rim = new THREE.DirectionalLight(0xe9c871, 0.7);
  rim.position.set(4, 1, -3);
  rigCam.add(key, rim);

  const dust = makeDust(lowPower ? 40 : 90, pr);
  rigCam.add(dust.points);

  const moon = makeMoon({ detail: !lowPower });
  rigCam.add(moon.group);
  const horizon = makeMoon({ detail: false });
  horizon.uniforms.uLight.value.set(-0.35, 0.9, 0.25).normalize();
  rigCam.add(horizon.group);

  const star = makeStar({ detail: !lowPower });
  rigCam.add(star.group);

  const glow = glowTexture();
  const jar = createJar({ glowMap: glow });
  rigCam.add(jar.rig);

  // карта звёзд-вкусов: орбита и метки вокруг банки
  const ringHost = new THREE.Group();
  const ringTilt = new THREE.Group();
  const ring = new THREE.Group();
  ringHost.add(ringTilt);
  ringTilt.add(ring);
  rigCam.add(ringHost);
  ringTilt.rotation.x = 0.5;
  ringTilt.rotation.z = -0.12;

  const orbitPts = [];
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    orbitPts.push(new THREE.Vector3(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R));
  }
  const orbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(orbitPts),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  ring.add(orbit);

  const glint = glintTexture();
  const orbs = FLAVORS.map((f, i) => {
    const a = (i / FLAVORS.length) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glint, color: f.a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8,
    }));
    sprite.scale.setScalar(0.5);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: f.a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4,
    }));
    halo.scale.setScalar(0.9);
    g.add(halo, sprite);
    ring.add(g);
    return { g, sprite, halo };
  });

  // ── постобработка и качество ───────────────────────────────────────
  let composer = null;
  let bloom = null;
  let fx = null;
  let level = lowPower ? 0 : 2; // 2 — всё, 1 — без блума, 0 — минимум
  if (forced !== undefined && forced !== null) level = Number(forced);
  if (!lowPower) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.6, 0.93);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    fx = createFXPass();
    composer.addPass(fx);
  }

  function size() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer?.setPixelRatio?.(pr);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    nebula.material.uniforms.uRes.value.set(w, h);
    dust.mat.uniforms.uRes.value.set(w * pr, h * pr);
    stars.mat.uniforms.uPR.value = pr;
    dust.mat.uniforms.uPR.value = pr;
  }

  function setQuality(l) {
    level = l;
    if (bloom) bloom.enabled = l >= 2;
    if (fx) fx.enabled = l >= 1;
    const next = Math.min(window.devicePixelRatio || 1, l >= 2 ? maxPR : l === 1 ? 1.25 : 1);
    if (next !== pr) {
      pr = next;
      size();
    }
  }
  size();
  setQuality(level);
  window.addEventListener('resize', size);

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const starPos = new THREE.Vector3();

  /** s — сглаженное состояние, посчитанное в main.js */
  function update(s) {
    const { time } = s;
    camera.position.z = 6 - s.fly * 200;
    camera.rotation.y = -s.px * 0.05;
    camera.rotation.x = s.py * 0.035;
    const fov = 40 + s.warp * 16 + (1 - s.intro) * 9;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (bloom) bloom.strength = 0.3 + s.warp * 0.45 + s.flash * 0.35;
    if (fx) {
      fx.uniforms.uWarp.value = level >= 2 ? s.warp : s.warp * 0.4;
      fx.uniforms.uFlash.value = s.flash;
      fx.uniforms.uFlashCol.value.copy(s.tint);
    }

    nebula.material.uniforms.uTime.value = time;
    nebula.material.uniforms.uScroll.value = s.fly;
    nebula.material.uniforms.uTint.value.copy(s.tint);
    stars.mat.uniforms.uTime.value = time;
    stars.points.rotation.z = time * 0.004 + s.fly * 0.3;

    dust.mat.uniforms.uTime.value = time;
    dust.mat.uniforms.uOffset.value += s.dt * (0.22 + s.warp * 16);
    dust.mat.uniforms.uTint.value.copy(s.tint);

    // звезда
    star.group.visible = s.star.vis > 0.003;
    star.group.position.set(s.star.x, s.star.y, s.star.z);
    star.core.scale.setScalar(s.star.s);
    star.corona.scale.setScalar(s.star.s * 7.5);
    star.streak.scale.set(s.star.s * 22, s.star.s * 0.6, 1);
    star.uniforms.uTime.value = time;
    star.uniforms.uK.value = s.star.vis;
    star.uniforms.uHot.value.copy(s.star.hot);
    star.uniforms.uCool.value.copy(s.star.cool);
    starPos.set(s.star.x, s.star.y, s.star.z);

    // луна: свет приходит от звезды
    moon.group.visible = s.moon.a > 0.005;
    moon.group.position.set(s.moon.x, s.moon.y, s.moon.z);
    moon.group.scale.setScalar(s.moon.s);
    moon.group.rotation.y = time * 0.008;
    moon.uniforms.uAlpha.value = s.moon.a;
    moon.uniforms.uRim.value.copy(s.moonRim);
    tmp.copy(starPos).sub(moon.group.position);
    if (tmp.lengthSq() > 1e-3) moon.uniforms.uLight.value.copy(tmp.normalize());

    horizon.group.visible = s.horizon.a > 0.005;
    horizon.group.position.set(0, s.horizon.y, -20);
    horizon.group.scale.setScalar(15);
    horizon.uniforms.uAlpha.value = s.horizon.a;
    horizon.uniforms.uRim.value.copy(s.moonRim);

    // банка
    const j = s.jar;
    jar.rig.visible = j.vis;
    jar.rig.position.set(j.x, j.y + Math.sin(time * 0.9) * 0.05, -6.6);
    jar.rig.scale.setScalar(j.s);
    jar.rig.rotation.set(j.rx, 0, j.rz);
    jar.spin.rotation.y = j.ry;
    jar.setAccent(s.tint);
    rim.color.lerp(s.tint, 0.03);

    // карта вкусов
    ringHost.visible = s.ring.vis > 0.01;
    ringHost.position.set(j.x, j.y, -6.6);
    ringHost.scale.setScalar(Math.max(0.001, s.ring.vis) * j.s * 0.8);
    ring.rotation.y = s.ring.rot;
    orbit.material.opacity = 0.16 * s.ring.vis;
    orbs.forEach((o, i) => {
      const on = i === s.ring.active;
      o.sprite.scale.setScalar(THREE.MathUtils.lerp(o.sprite.scale.x, on ? 1.35 : 0.5, 0.12));
      o.halo.scale.setScalar(THREE.MathUtils.lerp(o.halo.scale.x, on ? 2.1 : 0.9, 0.12));
      o.halo.material.opacity = THREE.MathUtils.lerp(o.halo.material.opacity, on ? 0.75 : 0.28, 0.12);
      o.sprite.material.opacity = THREE.MathUtils.lerp(o.sprite.material.opacity, on ? 1 : 0.7, 0.12);
    });

    camera.updateMatrixWorld(true);
    (composer || { render: () => renderer.render(scene, camera) }).render();
  }

  /** Экранные координаты меток орбиты: [{x, y, d}], d от 0 (сзади) до 1 (спереди). */
  function orbScreen(out) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ringHost.getWorldPosition(tmp2);
    const hostView = tmp2.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const span = RING_R * ringHost.scale.x * 1.2;
    orbs.forEach((o, i) => {
      o.g.getWorldPosition(tmp);
      const view = tmp.clone().applyMatrix4(camera.matrixWorldInverse).z;
      tmp.project(camera);
      const e = out[i] || (out[i] = { x: 0, y: 0, d: 0 });
      e.x = (tmp.x * 0.5 + 0.5) * w;
      e.y = (-tmp.y * 0.5 + 0.5) * h;
      e.d = THREE.MathUtils.clamp((view - hostView) / span * 0.5 + 0.5, 0, 1);
    });
    return out;
  }

  /** Экранная точка привязки на банке (для выносок). */
  function anchorScreen(name, out) {
    const a = jar.anchors[name];
    a.getWorldPosition(tmp);
    tmp.project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
    return out;
  }

  async function compile() {
    camera.updateMatrixWorld(true);
    try { await renderer.compileAsync(scene, camera); } catch { /* не критично: скомпилируется при первом кадре */ }
  }

  return { renderer, camera, jar, update, resize: size, setQuality, orbScreen, anchorScreen, compile, get level() { return level; } };
}

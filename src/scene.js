import * as THREE from 'three';
import { FLAVORS } from './data.js';
import { createJar } from './jar.js';
import { dotTexture, makeMoon, makeNebula, makeStar, makeStars } from './cosmos.js';

const RING_R = 2.6;

/** Студийное освещение: тёмная комната с софтбоксами. Хром получает чёткие, «предметные» блики. */
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
  box('#fff0d8', 7, 9, 7, [-0.7, 0.75, 0.55]); // основной мягкий источник сверху-слева
  box('#9cc3ff', 5, 2.2, 11, [1, 0.15, 0.35]); // холодная вертикальная полоса справа
  box('#ffffff', 4, 14, 1.6, [0, 1, 0.1]); // верхняя полоса
  box('#e9c871', 5, 6, 9, [0.65, 0.2, -1]); // золотой контровой сзади-справа
  box('#ffd9a0', 2.5, 7, 4, [-1, -0.2, -0.4]); // тёплый контровой сзади-слева
  box('#1b1d24', 1.2, 16, 16, [0, -1, 0]); // пол: слабый отсвет
  const tex = pm.fromScene(env, 0.025).texture;
  pm.dispose();
  return tex;
}

export async function createScene(canvas, { lowPower, light }) {
  // Рисуем прямо на экран: встроенное сглаживание (MSAA) и родное разрешение (до 2x), без промежуточных буферов.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxPR = lowPower ? 1.5 : 2;
  let pr = light ? 1 : Math.min(window.devicePixelRatio || 1, maxPR);
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  // потеря контекста (драйвер, нехватка памяти): без перезагрузки остался бы чёрный экран
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      if (sessionStorage.getItem('gds-ctx') === '1') return;
      sessionStorage.setItem('gds-ctx', '1');
    } catch { /* нет sessionStorage */ }
    location.reload();
  });

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  scene.add(camera);

  const nebula = makeNebula();
  scene.add(nebula.mesh);
  const stars = makeStars(lowPower ? 3200 : 6500, pr);
  stars.points.renderOrder = 5;
  scene.add(stars.points);

  // всё, что привязано к камере: камера летит сквозь звёзды, а кадр остаётся стабильным
  const rigCam = new THREE.Group();
  camera.add(rigCam);

  const key = new THREE.DirectionalLight(0xfff1d0, 0.4);
  key.position.set(-3, 4, 2);
  const rim = new THREE.DirectionalLight(0xe9c871, 0.55);
  rim.position.set(4, 1, -3);
  rigCam.add(key, rim);

  const moon = makeMoon();
  rigCam.add(moon.group);
  const star = makeStar();
  rigCam.add(star.group);

  const jar = createJar();
  rigCam.add(jar.rig);

  // карта звёзд-вкусов: тонкая орбита и маркеры вокруг банки
  const ringHost = new THREE.Group();
  const ringTilt = new THREE.Group();
  const ring = new THREE.Group();
  ringHost.add(ringTilt);
  ringTilt.add(ring);
  rigCam.add(ringHost);
  ringTilt.rotation.x = 0.5;
  ringTilt.rotation.z = -0.12;

  const orbitPts = [];
  for (let i = 0; i < 192; i++) {
    const a = (i / 192) * Math.PI * 2;
    orbitPts.push(new THREE.Vector3(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R));
  }
  const orbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(orbitPts),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }),
  );
  ring.add(orbit);

  const dot = dotTexture();
  const orbs = FLAVORS.map((f, i) => {
    const a = (i / FLAVORS.length) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: f.a, depthWrite: false, transparent: true, opacity: 0.85 }));
    sprite.scale.setScalar(0.075);
    g.add(sprite);
    ring.add(g);
    return { g, sprite };
  });

  let detail = lowPower || light ? 0 : 1;
  let lightLevel = light ? 3 : 0; // 1 проще шейдеры, 2 меньше пикселей, 3 минимум
  let pendingLight = 0;

  function size() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    nebula.setSize(w, h, lightLevel >= 2 ? 0.32 : 0.5);
    stars.mat.uniforms.uPR.value = pr;
  }
  function applyDetail() {
    moon.uniforms.uDetail.value = detail;
    star.uniforms.uDetail.value = detail;
  }
  size();
  applyDetail();
  window.addEventListener('resize', size);

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const starPos = new THREE.Vector3();

  /** Упрощает сцену на слабом устройстве (уровень 1, 2 или 3). Применяется в начале следующего кадра, прямо перед отрисовкой. */
  function enterLightMode(level = 1) {
    pendingLight = Math.max(pendingLight, level);
  }

  /** s: сглаженное состояние, посчитанное в main.js */
  function update(s) {
    if (pendingLight > lightLevel) {
      // меняем размер холста ДО отрисовки: он очищается при изменении, и кадр без отрисовки показал бы чёрный экран
      lightLevel = pendingLight;
      detail = 0;
      const dpr = window.devicePixelRatio || 1;
      // сначала упрощаем шейдеры (уровень 1), и лишь потом отдаём разрешение: чёткость банки важнее всего
      if (lightLevel === 2) pr = Math.max(1, Math.min(pr, dpr * 0.75));
      if (lightLevel >= 3) pr = 1;
      size();
      applyDetail();
    }
    const { time } = s;
    camera.position.z = 6 - s.fly * 200;
    camera.rotation.y = -s.px * 0.04;
    camera.rotation.x = s.py * 0.03;
    const fov = 40 + s.warp * 4 + (1 - s.intro) * 7;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    nebula.uniforms.uTime.value = time;
    nebula.uniforms.uScroll.value = s.fly;
    nebula.uniforms.uTint.value.copy(s.tint);
    stars.mat.uniforms.uTime.value = time;
    stars.points.rotation.z = time * 0.003 + s.fly * 0.3;

    // звезда
    star.group.visible = s.star.vis > 0.003;
    star.group.position.set(s.star.x, s.star.y, s.star.z);
    star.core.visible = s.star.core > 0.01;
    star.core.scale.setScalar(Math.max(0.001, s.star.s * s.star.core));
    star.corona.scale.setScalar(s.star.s * 7);
    star.uniforms.uTime.value = time;
    star.uniforms.uK.value = s.star.vis;
    star.uniforms.uHot.value.copy(s.star.hot);
    star.uniforms.uCool.value.copy(s.star.cool);
    starPos.set(s.star.x, s.star.y, s.star.z);

    // луна: свет приходит от звезды
    moon.group.visible = s.moon.a > 0.005;
    moon.group.position.set(s.moon.x, s.moon.y, s.moon.z);
    moon.group.scale.setScalar(s.moon.s);
    moon.group.rotation.y = time * 0.006;
    moon.uniforms.uAlpha.value = s.moon.a;
    moon.uniforms.uGain.value = s.moon.g;
    moon.uniforms.uRim.value.copy(s.moonRim);
    tmp.copy(starPos).sub(moon.group.position);
    if (tmp.lengthSq() > 1e-3) moon.uniforms.uLight.value.copy(tmp.normalize());

    // банка
    const j = s.jar;
    jar.rig.visible = j.vis;
    jar.rig.position.set(j.x, j.y + Math.sin(time * 0.9) * 0.04, -6.6);
    jar.rig.scale.setScalar(j.s);
    jar.rig.rotation.set(j.rx, 0, j.rz);
    jar.spin.rotation.y = j.ry;
    rim.color.lerp(s.tint, 0.03);

    // карта вкусов
    ringHost.visible = s.ring.vis > 0.01;
    ringHost.position.set(j.x, j.y, -6.6);
    ringHost.scale.setScalar(Math.max(0.001, s.ring.vis) * j.s * 0.8);
    ring.rotation.y = s.ring.rot;
    orbit.material.opacity = 0.2 * s.ring.vis;
    orbs.forEach((o, i) => {
      const on = i === s.ring.active;
      o.sprite.scale.setScalar(THREE.MathUtils.lerp(o.sprite.scale.x, on ? 0.14 : 0.075, 0.14));
      o.sprite.material.opacity = THREE.MathUtils.lerp(o.sprite.material.opacity, on ? 1 : 0.7, 0.14);
    });

    camera.updateMatrixWorld(true);
    nebula.render(renderer);
    renderer.render(scene, camera);
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
      e.d = THREE.MathUtils.clamp(((view - hostView) / span) * 0.5 + 0.5, 0, 1);
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
    try { await renderer.compileAsync(scene, camera); } catch { /* скомпилируется при первом кадре */ }
  }

  return { renderer, camera, jar, update, resize: size, debug: { moon: moon.group, star: star.group, stars: stars.points, jar: jar.rig, nebula: nebula.mesh }, enterLightMode, orbScreen, anchorScreen, compile, get pixelRatio() { return pr; }, get lightLevel() { return lightLevel; } };
}

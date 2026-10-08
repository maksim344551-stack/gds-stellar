import * as THREE from 'three';
import { FLAVORS } from './data.js';
import { createJar } from './jar.js';
import moonUrl from './assets/moon.jpg';
import { makeMoon, makePlanets, makeNebula, makeStar, makeStars } from './cosmos.js';

// p00..p09 планеты вкусов, p10 планета упаковки (порядок по имени файла)
const PLANET_URLS = Object.entries(import.meta.glob('./assets/planets/p*.jpg', { eager: true, query: '?url', import: 'default' }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

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

  const moon = makeMoon(moonUrl, renderer.capabilities.getMaxAnisotropy());
  rigCam.add(moon.group);
  const planets = makePlanets(PLANET_URLS, renderer);
  rigCam.add(planets.cur.mesh, planets.next.mesh);
  const star = makeStar();
  rigCam.add(star.group);

  const jar = await createJar();
  rigCam.add(jar.rig);

  let detail = lowPower || light ? 0 : 1;
  let lightLevel = light ? 3 : 0; // 1 проще шейдеры, 2 меньше пикселей, 3 минимум
  let pendingLight = 0;

  // На телефоне адресная строка прячется и показывается при прокрутке, и innerHeight меняется на 50-100 px. Холст берёт «большую»
  // высоту окна (100lvh): она при этом не меняется, поэтому буфер не пересоздаётся, и на прокрутке нет ни рывков, ни пустых кадров.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100lvh;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  let viewW = 0;
  let viewH = 0;
  const readSize = () => ({ w: window.innerWidth, h: Math.max(probe.offsetHeight, window.innerHeight) });

  function size(force = false) {
    const { w, h } = readSize();
    if (!force && w === viewW && h === viewH) return;
    viewW = w;
    viewH = h;
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
  size(true);
  applyDetail();
  window.addEventListener('resize', () => size());

  const ORIGIN = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const moonM = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
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
      size(true);
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
    // ближней стороной к камере (камера в начале координат rig); радиус чуть меньше: сфера в перспективе шире плоского диска
    moonM.lookAt(ORIGIN, moon.group.position, UP);
    moon.group.quaternion.setFromRotationMatrix(moonM);
    moon.group.scale.setScalar(s.moon.s * 0.92);
    // либрация: два медленных покачивания разного периода, плюс доворот при прокрутке
    moon.uniforms.uYaw.value = 0.09 * Math.sin(time * 0.16) + s.moon.r;
    moon.uniforms.uPitch.value = 0.06 * Math.sin(time * 0.11 + 1.3);
    moon.uniforms.uAlpha.value = s.moon.a;
    moon.uniforms.uGain.value = s.moon.g;
    moon.uniforms.uRim.value.copy(s.moonRim);
    tmp.copy(starPos).sub(moon.group.position);
    if (tmp.lengthSq() > 1e-3) moon.uniforms.uLight.value.copy(tmp.normalize());

    // Небесные тела за банкой: планета упаковки (индекс 10) и десять планет вкусов (0..9); -1 значит «ничего» (первый экран с луной). Каждая смена, включая переход
    // от упаковки к первому вкусу, одна и та же: прежнее тело уходит вдаль и в сторону, следующее приближается
    // из глубины с противоположной стороны. Кривые у них разные, поэтому движение не зеркальное.
    const pl = s.planet;
    const P = planets;
    const narrow = camera.aspect < 0.95;
    const H = narrow ? 15 : 17;
    const W = H * (1100 / 1387);
    const bx = (narrow ? 0 : 7.4) + s.px * 0.5;
    const by = (narrow ? 1.9 : 0.4) + Math.sin(time * 0.25) * 0.12 - s.py * 0.3;
    const bz = narrow ? -20 : -22;
    const sm = THREE.MathUtils.smoothstep;
    const m = pl.mix;
    const out = sm(m, 0, 0.8);
    const outE = out * out * (3 - 2 * out);
    const inn = sm(m, 0.1, 1);
    const inE = 1 - Math.pow(1 - inn, 3);
    const fOut = 1 - sm(m, 0.1, 0.8);
    const fIn = sm(m, 0.15, 0.75);
    const fade = pl.alpha * (narrow ? 0.8 : 1);

    const place = (id, slot, dx, dy, dz, rz, alpha) => {
      if (id < 0) { slot.mesh.visible = false; return; } // -1: пустой этап (первый экран с луной)
      const a = fade * alpha;
      slot.mesh.visible = a > 0.004;
      if (!slot.mesh.visible) return;
      slot.mesh.position.set(bx + dx, by + dy, bz + dz);
      slot.mesh.rotation.z = rz;
      slot.mesh.scale.set(W, H, 1);
      slot.uniforms.uMap.value = P.get(id);
      slot.uniforms.uAlpha.value = a;
    };
    // на узком экране видно всего ~7 единиц в ширину: смещения короче и в основном вертикальные (прежняя уходит вверх и вдаль,
    // следующая поднимается снизу), иначе планета за долю секунды вылетала бы из кадра
    if (narrow) {
      place(pl.a, P.cur, -1.6 * outE, 3.6 * outE, -9 * outE, 0.1 * outE, fOut);
      if (m > 0.001) place(pl.b, P.next, 1.8 * (1 - inE), -5.2 * (1 - inE), -12 * (1 - inE), -0.12 * (1 - inE), fIn);
    } else {
      place(pl.a, P.cur, -7 * outE, 2 * outE, -9 * outE, 0.18 * outE, fOut);
      if (m > 0.001) place(pl.b, P.next, 8 * (1 - inE), -3.4 * (1 - inE), -12 * (1 - inE), -0.22 * (1 - inE), fIn);
    }
    if (m <= 0.001) P.next.mesh.visible = false;

    // банка
    const j = s.jar;
    jar.rig.visible = j.vis;
    jar.rig.position.set(j.x, j.y + Math.sin(time * 0.9) * 0.04, -6.6);
    jar.rig.scale.setScalar(j.s);
    jar.rig.rotation.set(j.rx, 0, j.rz);
    jar.spin.rotation.y = j.ry;
    rim.color.lerp(s.tint, 0.03);

    camera.updateMatrixWorld(true);
    nebula.render(renderer);
    renderer.render(scene, camera);
  }

  /** Экранная точка привязки на банке (для выносок). */
  function anchorScreen(name, out) {
    const a = jar.anchors[name];
    a.getWorldPosition(tmp);
    tmp.project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * viewW;
    out.y = (-tmp.y * 0.5 + 0.5) * viewH;
    return out;
  }

  async function compile() {
    camera.updateMatrixWorld(true);
    // скрытые объекты (планеты, гигант, луна, звезда) иначе компилировались бы при первом показе: подвисание кадра на скролле
    const hidden = [];
    scene.traverse((o) => { if (!o.visible) hidden.push(o); });
    hidden.forEach((o) => { o.visible = true; });
    try { await renderer.compileAsync(scene, camera); } catch { /* скомпилируется при первом кадре */ }
    hidden.forEach((o) => { o.visible = false; });
  }

  return { renderer, camera, jar, planets, update, resize: size, debug: { moon: moon.group, star: star.group, stars: stars.points, jar: jar.rig, nebula: nebula.mesh }, enterLightMode, anchorScreen, compile, get pixelRatio() { return pr; }, get lightLevel() { return lightLevel; } };
}

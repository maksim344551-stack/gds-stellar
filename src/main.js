import './style.css';
import * as THREE from 'three';
import { BRAND, FLAVORS, SKINS } from './data.js';
import { nb, typografDOM } from './typo.js';
import { hydrateIcons, initForm, initReveals } from './ui.js';
import { createScene } from './scene.js';
import { loadSkinAssets, warmSkins } from './skins.js';
import { loadCatalog, applyCatalog } from './catalog.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  if (b === a) return x >= b ? 1 : 0;
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const pad = (n) => String(n).padStart(2, '0');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

// ── окружение ──────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('reduced');
const coarse = matchMedia('(pointer: coarse)').matches;
const lowPower = coarse || (navigator.hardwareConcurrency || 8) <= 4 || params.has('low');
const forcedLight = params.get('q') === '0'; // ?q=0 упрощённая сцена, ?q=2 полная без автоподбора
const forcedFull = params.get('q') === '2';
const DT_MAX = Number(params.get('dtmax')) || 0.05; // верхняя граница шага времени (для отладки на медленных машинах)
if (reduced) root.classList.add('reduced');

const el = {
  loader: $('#loader'), fill: $('#ld-fill'), pct: $('#ld-pct'),
  gate: $('#gate'), nav: $('#nav'),
  product: $('#product'), flavors: $('#flavors'), blend: $('#blend'), partners: $('#partners'), contact: $('#contact'),
  fIdx: $('#f-idx'), fName: $('#f-name'), fRu: $('#f-ru'), fDesc: $('#f-desc'), fAstro: $('#f-astro'), fList: $('#f-list'),
  fPrev: $('#f-prev'), fNext: $('#f-next'), fPanel: $('.f-panel'), fMore: $('#f-more'),
  overlay: $('#overlay'),
  navLinks: $$('.nav-links a[data-sec]'),
};
// блок вкусов: один закреплённый экран с небольшим запасом прокрутки; вкус выбирается нажатием, а не длиной страницы
el.flavors.style.height = 'calc(1.3 * 100svh)';

// ── заставка ───────────────────────────────────────────────────────
const loader = { target: 0, shown: 0, finished: false };
const progress = (p) => { loader.target = Math.max(loader.target, p); };
(function loaderTick() {
  loader.shown += (loader.target - loader.shown) * 0.1;
  if (loader.target >= 1 && loader.shown > 0.996) loader.shown = 1;
  el.fill.style.transform = `scaleX(${loader.shown.toFixed(4)})`;
  el.pct.textContent = pad(Math.round(loader.shown * 100));
  if (!loader.finished) requestAnimationFrame(loaderTick);
})();

typografDOM(document.body);
hydrateIcons();

// ── твины без библиотек ────────────────────────────────────────────
const tweens = new Set();
function tween({ duration, ease = easeInOut, from = 0, to = 1, onUpdate, onComplete }) {
  const t = { t0: performance.now(), duration, ease, from, to, onUpdate, onComplete };
  tweens.add(t);
  return t;
}
function stepTweens(now) {
  for (const t of tweens) {
    const p = clamp((now - t.t0) / t.duration);
    t.onUpdate?.(lerp(t.from, t.to, t.ease(p)), p);
    if (p >= 1) { tweens.delete(t); t.onComplete?.(); }
  }
}

// ── элементы, зависящие от данных ──────────────────────────────────
FLAVORS.forEach((f, i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = f.star;
  b.dataset.i = String(i);
  b.style.setProperty('--dot', f.a);
  li.append(b);
  el.fList.append(li);
});
const fButtons = $$('button', el.fList);
const swapEls = [el.fName, el.fRu, el.fDesc, el.fAstro];
swapEls.forEach((e) => e.classList.add('f-swap'));

const calloutDefs = [{ k: 'lid', t: 'Крышка с полусферой' }, { k: 'body', t: 'Обечайка' }, { k: 'base', t: '25 г табака' }];
const callouts = calloutDefs.map((c) => {
  const d = document.createElement('div');
  d.className = 'callout';
  const t = document.createElement('span');
  t.className = 'co-text';
  t.textContent = nb(c.t);
  const l = document.createElement('span');
  l.className = 'co-line';
  const dot = document.createElement('span');
  dot.className = 'co-dot';
  d.append(t, l, dot);
  el.overlay.append(d);
  return { ...c, node: d };
});

// ── прокрутка: обычная, браузерная ─────────────────────────────────
function scrollToY(y) {
  window.scrollTo({ top: Math.max(0, y), behavior: reduced ? 'auto' : 'smooth' });
}

let L = { vh: innerHeight, prodTop: 0, prodH: 1, flavTop: 0, flavH: 1, blendTop: 0, partnersTop: 0, contactTop: 0, docH: 1 };
function measure() {
  const top = (e) => e.getBoundingClientRect().top + window.scrollY;
  const vh = $('.pin', el.flavors).offsetHeight || window.innerHeight || 720;
  L = {
    vh,
    prodTop: top(el.product), prodH: el.product.offsetHeight,
    flavTop: top(el.flavors), flavH: el.flavors.offsetHeight,
    blendTop: top(el.blend), partnersTop: top(el.partners), contactTop: top(el.contact),
    docH: document.documentElement.scrollHeight,
  };
}
measure();
addEventListener('resize', measure);
addEventListener('load', measure);
document.fonts?.ready.then(measure);

// ── состояние сцены ────────────────────────────────────────────────
const GOLD_HOT = new THREE.Color('#ffe2a0');
const GOLD_COOL = new THREE.Color('#9c4a12');
const intro = { v: reduced ? 1 : 0 };
const spin = { v: 0 };
const cur = {
  time: 0, dt: 0.016, fly: 0, warp: 0, px: 0, py: 0, intro: 0, co: 0,
  tint: new THREE.Color(BRAND.a),
  moonRim: new THREE.Color('#cdac62'),
  moon: { x: 3.4, y: -4, z: -12, s: 5.2, a: 0, g: 1, r: 0 },
  planet: { a: -1, b: -1, mix: 0, alpha: 1 }, // a, b: -1 ничего, 0..9 планеты вкусов, 10 планета упаковки
  star: { x: 10, y: 0.6, z: -17, s: 1.7, core: 0, vis: 0, hot: GOLD_HOT.clone(), cool: GOLD_COOL.clone() },
  jar: { x: 1.8, y: -3, s: 0.6, ry: 0, rx: 0.36, rz: -0.22, vis: false },
};
const tintTarget = new THREE.Color(BRAND.a);
const hotTarget = GOLD_HOT.clone();
const coolTarget = GOLD_COOL.clone();
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let lastScrim = -1;
let navRef = 0;
let skinId = 'brand';
let flavorIdx = 0;
let swapTimer = 0;
let accentReset = false;
let spinTween = null;
let prevY = 0;
let section = '';
let sc = null;

// На телефоне длинное описание вкуса обрезается; кнопка «Подробнее» показывается только когда текст не поместился.
function collapseDesc() {
  el.fPanel.classList.remove('open');
  el.fMore.setAttribute('aria-expanded', 'false');
  el.fMore.textContent = 'Подробнее';
}
function updateMore() {
  requestAnimationFrame(() => {
    const open = el.fPanel.classList.contains('open');
    el.fMore.classList.toggle('show', open || el.fDesc.scrollHeight > el.fDesc.clientHeight + 2);
  });
}
el.fMore.addEventListener('click', () => {
  const open = el.fPanel.classList.toggle('open');
  el.fMore.setAttribute('aria-expanded', String(open));
  el.fMore.textContent = open ? 'Свернуть' : 'Подробнее';
});
addEventListener('resize', updateMore);

function showFlavor(i) {
  const f = FLAVORS[i];
  fButtons.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  // на телефоне список вкусов прокручивается вбок: выбранный вкус держим в центре, чтобы он не уходил за край экрана
  const list = el.fList;
  if (list.scrollWidth > list.clientWidth + 4) {
    const b = fButtons[i];
    list.scrollTo({ left: b.parentElement.offsetLeft - (list.clientWidth - b.offsetWidth) / 2, behavior: reduced ? 'auto' : 'smooth' });
  }
  swapEls.forEach((e) => e.classList.add('out'));
  collapseDesc();
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => {
    el.fIdx.textContent = pad(i + 1);
    el.fName.textContent = f.star;
    el.fRu.textContent = nb(f.ru);
    el.fDesc.textContent = nb(f.desc);
    el.fAstro.replaceChildren();
    const rows = f.astro
      ? [['Звезда', `${f.astro.bayer}, ${f.astro.sky}`], ['Расстояние', f.astro.dist]]
      : [['Линейка', 'Stellar, десятый вкус']];
    rows.forEach(([k, v]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = nb(v);
      row.append(dt, dd);
      el.fAstro.append(row);
    });
    swapEls.forEach((e) => e.classList.remove('out'));
    updateMore();
  }, reduced ? 0 : 240);
}

function setAccent(skin) {
  root.style.setProperty('--fa', skin.id === 'brand' ? '#cdac62' : skin.a);
  tintTarget.set(skin.a);
  if (skin.id === 'brand') {
    hotTarget.copy(GOLD_HOT);
    coolTarget.copy(GOLD_COOL);
  } else {
    hotTarget.set(skin.a).lerp(new THREE.Color('#ffffff'), 0.32);
    coolTarget.set(skin.b);
  }
}

function neighbours(i) {
  const n = FLAVORS.length;
  return [FLAVORS[(i + 1) % n].id, FLAVORS[(i - 1 + n) % n].id];
}

function goSkin(id, instant = false) {
  if (id === skinId) return;
  skinId = id;
  setAccent(SKINS[id]);
  if (!sc) return;
  if (spinTween) { tweens.delete(spinTween); spinTween = null; }
  const TAU = Math.PI * 2;
  if (instant || reduced) { spin.v = Math.round(spin.v / TAU) * TAU; sc.jar.setSkin(id); return; }
  // Оборот банки: этикетка меняется, когда повёрнута к стене. Если вкус сменился посреди оборота (быстрая прокрутка пальцем),
  // банка доворачивает до ближайшего целого оборота, а не начинает новый от текущего угла: иначе она застревала боком.
  const start = spin.v;
  const to = (Math.floor(start / TAU + 1e-6) + 1) * TAU;
  let swapped = false;
  spinTween = tween({
    duration: 1100 * Math.max(0.5, (to - start) / TAU),
    from: start,
    to,
    onUpdate: (v, p) => {
      spin.v = v;
      if (!swapped && p > 0.5) { swapped = true; sc.jar.setSkin(id); }
    },
    onComplete: () => { spin.v = 0; spinTween = null; sc.jar.setSkin(id); warmSkins(neighbours(flavorIdx), sc.renderer); },
  });
}

// Небесные тела: каждая смена идёт одним и тем же 2,2-секундным переходом. Если цель изменилась на ходу, текущий
// переход доигрывается целиком, а следом сразу идёт переход к последней цели (промежуточные пропускаются).
let stageTween = null;
let stageWait = 0;
function requestStage(want) {
  const p = cur.planet;
  if (stageTween || p.b !== p.a || want === p.b) return;
  if (reduced) { p.a = p.b = want; return; }
  // планета выходит в кадр только когда её снимок уже на видеокарте (не дольше 2 с), иначе переход «висит» на пустом месте
  if (sc && !sc.planets.ready(want) && stageWait < 120) { sc.planets.get(want); stageWait += 1; return; }
  stageWait = 0;
  p.b = want;
  p.mix = 0;
  stageTween = tween({
    duration: 2200,
    ease: (x) => x,
    onUpdate: (v) => { p.mix = v; },
    onComplete: () => { p.a = p.b; p.mix = 0; stageTween = null; },
  });
}

// Вкус выбирает пользователь (нажатие, стрелки, клавиши, свайп); прокрутка вкус не меняет.
let flavorsActive = false;
function setFlavor(i) {
  if (i === flavorIdx) return;
  flavorIdx = i;
  showFlavor(i);
  if (flavorsActive) goSkin(FLAVORS[i].id);
}
showFlavor(0);

fButtons.forEach((b) => b.addEventListener('click', () => setFlavor(Number(b.dataset.i))));
// меню на телефоне
const navToggle = $('#nav-toggle');
const setMenu = (open) => {
  el.nav.classList.toggle('open', open);
  root.classList.toggle('menu-open', open); // страница под меню не прокручивается
  navToggle.setAttribute('aria-expanded', String(open));
};
navToggle.addEventListener('click', () => setMenu(!el.nav.classList.contains('open')));
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
addEventListener('resize', () => { if (innerWidth > 900) setMenu(false); });
$$('.nav-links a, .nav-cta, .nav-logo').forEach((a) => a.addEventListener('click', () => setMenu(false)));

const stepFlavor = (d) => setFlavor((flavorIdx + d + FLAVORS.length) % FLAVORS.length);
// свайп по сцене вкусов: горизонтальный жест листает вкус, вертикальная прокрутка не затрагивается
{
  const zone = $('.pin-flavors');
  let sx = 0; let sy = 0;
  zone.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  zone.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) stepFlavor(dx < 0 ? 1 : -1);
  }, { passive: true });
}
el.fPrev.addEventListener('click', () => stepFlavor(-1));
el.fNext.addEventListener('click', () => stepFlavor(1));
addEventListener('keydown', (e) => {
  const y = window.scrollY;
  const inFlavors = y > L.flavTop - L.vh * 0.2 && y < L.flavTop + L.flavH - L.vh * 0.8;
  if (!inFlavors || e.target.closest?.('input, textarea')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); stepFlavor(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepFlavor(-1); }
});

$$('[data-go]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const id = a.dataset.go;
  let y = 0;
  if (id === 'product') y = L.prodTop;
  else if (id === 'flavors') y = L.flavTop + L.vh * 0.1;
  else if (id !== 'hero') y = (el[id] || $(`#${id}`)).getBoundingClientRect().top + window.scrollY;
  scrollToY(y);
}));

// ── цели анимации по скроллу ───────────────────────────────────────
function targets(y) {
  const { vh } = L;
  const aspect = innerWidth / innerHeight;
  const narrow = aspect < 0.95;
  const hero = sstep(0, vh * 0.9, y);
  const flavT = sstep(L.flavTop - vh * 0.55, L.flavTop + vh * 0.05, y);
  const flavEnd = L.flavTop + L.flavH - vh;
  const exit = sstep(flavEnd, flavEnd + vh * 0.95, y);
  const iv = easeOut(cur.intro);
  // банка стоит справа от оси взгляда: чтобы лицевая сторона смотрела точно на покупателя, её доворачивают на угол линии взгляда
  const face = narrow ? 0 : -Math.atan2(1.9, 6.6);

  const t = { flavT, exit, hero, narrow };

  // луна: в первом экране большая, снизу справа; дальше уходит влево и вверх
  t.moon = narrow
    ? { x: lerp(0.6, -10, hero), y: lerp(-7.4, 3, hero) - (1 - iv) * 2, z: lerp(-12, -30, hero), s: 4.2, a: 1 - hero, g: 0.55, r: -0.16 * hero }
    : { x: lerp(3.5, -10, hero), y: lerp(-3.6, 3, hero) - (1 - iv) * 2.4, z: lerp(-12, -30, hero), s: lerp(5.2, 4.4, hero) * lerp(0.92, 1, iv), a: (1 - hero) * clamp(iv * 1.6), g: 1, r: -0.16 * hero };

  // звезда: за краем луны в первом экране, тускнеет в упаковке, встаёт за банкой в линейке
  const sHero = narrow ? { x: 7, y: 0.4, z: -17, s: 0.9, c: 0, k: 1.1 } : { x: 9.1, y: 1.5, z: -17, s: 1.15, c: 0, k: 1.1 };
  const sProd = { x: -12.5, y: 6.8, z: -26, s: 0.55, c: 0, k: 0 };
  const sFlav = narrow ? { x: 0.4, y: 2.2, z: -18, s: 2.1, c: 0, k: 0 } : { x: 3.6, y: 0.3, z: -18, s: 2.7, c: 0, k: 0 };
  const a = (p, q, k) => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), z: lerp(p.z, q.z, k), s: lerp(p.s, q.s, k), c: lerp(p.c, q.c, k), k: lerp(p.k, q.k, k) });
  const s2 = a(a(sHero, sProd, hero), sFlav, flavT);
  t.star = { ...s2, vis: s2.k * (1 - exit) * clamp(iv * 1.4) };

  // банка
  const sway = Math.sin(cur.time * 0.45) * 0.5 + pointer.x * 0.35;
  const swayAmp = lerp(lerp(0.45, 0.25, hero), 0.1, flavT);
  t.jar = {
    x: narrow ? 0 : lerp(1.8, 1.9, hero),
    y: (narrow ? lerp(1.4, 1.25, hero) : 0) + exit * 8 - (1 - iv) * 1.2,
    // на невысоких телефонах банка меньше, чтобы подпись блока не заезжала на неё
    s: (narrow ? 0.74 * lerp(0.82, 1, clamp((innerHeight - 568) / 276)) : 1.12) * lerp(0.5, 1, iv) * (1 + exit * 0.9),
    // лицевая сторона (вкус, логотип) всегда к покупателю, банка лишь слегка покачивается
    ry: face + sway * swayAmp + exit * Math.PI * 1.2,
    rx: lerp(0.36, 0.26, flavT) - pointer.y * 0.06,
    rz: lerp(-0.22, -0.07, flavT),
    vis: iv > 0.02 && exit < 0.998,
  };
  return t;
}

// ── главный цикл ───────────────────────────────────────────────────
let last = performance.now();
const perf = { warm: 240, samples: [], done: forcedLight || forcedFull };
const tmpP = { x: 0, y: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  const dt = clamp(raw, 0, DT_MAX);
  last = now;
  stepTweens(now);
  const y = window.scrollY;
  cur.time += dt;
  cur.dt = dt;
  cur.intro = intro.v;

  // навигация: текущий раздел и фон шапки
  const marks = [['hero', 0], ['product', L.prodTop], ['flavors', L.flavTop], ['blend', L.blendTop], ['partners', L.partnersTop], ['contact', L.contactTop]];
  let sec = 'hero';
  for (const [id, top] of marks) if (y >= top - L.vh * 0.5) sec = id;
  if (sec !== section) {
    section = sec;
    el.navLinks.forEach((a) => (a.dataset.sec === sec ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  }
  el.nav.classList.toggle('solid', y > 40);
  // Шапка без фона, поэтому на тексте она читалась бы плохо: при прокрутке вниз она уезжает вверх, при прокрутке вверх возвращается.
  // На телефоне это работает с первого экрана, на компьютере ниже сцены. navRef запоминает точку разворота, чтобы дрожание пальца не мигало шапкой.
  const navFrom = innerWidth <= 900 ? 80 : L.blendTop - L.vh * 0.5;
  if (y <= navFrom || el.nav.classList.contains('open')) { el.nav.classList.remove('away'); navRef = y; }
  else if (el.nav.classList.contains('away')) {
    if (y < navRef - 14) { el.nav.classList.remove('away'); navRef = y; } else navRef = Math.max(navRef, y);
  } else if (y > navRef + 14) { el.nav.classList.add('away'); navRef = y; } else navRef = Math.min(navRef, y);

  // ниже сцены лежат сплошные блоки: 3D не рисуем, пока он полностью закрыт
  const sceneVisible = y < L.blendTop;
  if (el.overlay.hidden === sceneVisible) el.overlay.hidden = !sceneVisible; // подписи не должны «застревать» поверх сплошных блоков
  if (!sceneVisible) { prevY = y; return; }

  const vel = (y - prevY) / Math.max(dt, 0.001);
  prevY = y;
  const k = (n) => 1 - Math.exp(-dt * n);
  pointer.x = lerp(pointer.x, pointer.tx, k(4));
  pointer.y = lerp(pointer.y, pointer.ty, k(4));
  const t = targets(y);

  cur.planet.alpha = lerp(cur.planet.alpha, 1 - t.exit, k(5));
  cur.fly = lerp(cur.fly, clamp(y / Math.max(1, L.docH - L.vh)), k(5));
  cur.warp = lerp(cur.warp, clamp(Math.abs(vel) / 5000), k(4));
  cur.px = pointer.x;
  cur.py = pointer.y;
  cur.tint.lerp(tintTarget, k(3));

  for (const key of ['x', 'y', 'z', 's', 'a', 'g', 'r']) cur.moon[key] = lerp(cur.moon[key], t.moon[key], k(6));
  for (const key of ['x', 'y', 'z', 's', 'core', 'vis']) cur.star[key] = lerp(cur.star[key], key === 'core' ? t.star.c : t.star[key], k(5));
  cur.star.hot.lerp(hotTarget, k(3));
  cur.star.cool.lerp(coolTarget, k(3));
  for (const key of ['x', 'y', 's', 'ry', 'rx', 'rz']) cur.jar[key] = lerp(cur.jar[key], t.jar[key], k(key === 'ry' ? 5 : 6));
  cur.jar.vis = t.jar.vis;

  // какая «шкура» у банки
  const inFlavors = t.flavT > 0.5 && !(t.exit > 0.6);
  flavorsActive = inFlavors && t.jar.vis;
  if (!t.jar.vis) { goSkin('brand', true); accentReset = false; }
  else if (inFlavors) {
    goSkin(FLAVORS[flavorIdx].id);
    if (accentReset) { accentReset = false; setAccent(SKINS[skinId]); }
  } else if (t.exit > 0.6) {
    // банка улетает: цвет сцены возвращается к золоту, пока она ещё в кадре
    if (!accentReset) { accentReset = true; setAccent(BRAND); }
  } else if (t.flavT <= 0.5) goSkin('brand');

  // небесное тело за банкой: в линейке планета текущего вкуса, до неё планета упаковки, в первом экране только луна; при вылете банки остаётся как есть
  if (t.exit < 0.02) requestStage(inFlavors && t.jar.vis ? flavorIdx : t.hero > 0.5 ? 10 : -1);

  // затемнение под текстом на телефоне проявляется вместе с появлением банки и уходит вместе с ней
  const scrim = sstep(L.vh * 0.45, L.vh * 0.95, window.scrollY) * (1 - t.exit);
  if (Math.abs(scrim - lastScrim) > 0.004) { lastScrim = scrim; root.style.setProperty('--scrim', scrim.toFixed(3)); }

  if (!sc) return;
  sc.update({ ...cur, jar: { ...cur.jar, ry: cur.jar.ry + spin.v } });

  // выноски на банке: пока на экране блок «Упаковка», только на широком экране
  const inPack = y > L.prodTop - L.vh * 0.3 && y < L.flavTop - L.vh * 0.5;
  const wantCo = inPack && t.jar.vis && !t.narrow && innerHeight > 560 ? 1 : 0;
  cur.co = lerp(cur.co, wantCo, k(6));
  callouts.forEach((c) => {
    if (cur.co < 0.01) { if (c.node.style.opacity !== '0') c.node.style.opacity = '0'; return; }
    sc.anchorScreen(c.k, tmpP);
    c.node.style.transform = `translate3d(${tmpP.x.toFixed(1)}px, ${tmpP.y.toFixed(1)}px, 0) translate(-100%, -50%)`;
    c.node.style.opacity = cur.co.toFixed(3);
  });

  // слабое устройство: один раз упрощаем сцену (после прогрева, по медиане, а не по среднему)
  if (!perf.done && introStarted) {
    if (perf.warm > 0) perf.warm -= 1;
    else {
      if (raw < 0.1) perf.samples.push(raw);
      if (perf.samples.length >= 150) {
        const sorted = [...perf.samples].sort((a, b) => a - b);
        if (sorted[sorted.length >> 1] > 0.045) sc.enterLightMode(Math.min(3, sc.lightLevel + 1));
        perf.done = true;
      }
    }
  }
}

// ── возрастной экран и запуск ──────────────────────────────────────
let introStarted = false;
function startIntro() {
  if (introStarted) return;
  introStarted = true;
  root.classList.remove('is-locked');
  root.classList.add('is-ready');
  if (reduced) return;
  tween({ duration: 2800, ease: easeOut, onUpdate: (v) => { intro.v = v; } });
}

const inertTargets = [$('#main'), $('.footer'), el.nav];
const setInert = (v) => inertTargets.forEach((n) => { if (n) n.inert = v; });

function showGate() {
  setInert(true); // пока открыт возрастной экран, остальная страница недоступна ни мыши, ни клавиатуре
  el.gate.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.gate.classList.remove('hide');
    $('#gate-yes').focus({ preventScroll: true });
  }));
}
$('#gate-yes').addEventListener('click', () => {
  store.set('gds-18', '1');
  setInert(false);
  el.gate.classList.add('hide');
  setTimeout(() => { el.gate.hidden = true; }, 600);
  startIntro();
});
$('#gate-no').addEventListener('click', () => { $('#gate-deny').hidden = false; });
el.gate.classList.add('hide');

/** Медиана длительности кадра в мс за n кадров (первые несколько пропускаем: прогрев). Null, если вкладка скрыта. */
async function medianFrameMs(n) {
  const times = [];
  let prev = performance.now();
  for (let i = 0; i < n + 6; i++) {
    await nextFrame();
    const now = performance.now();
    if (document.hidden) return null;
    if (i >= 6) times.push(now - prev);
    prev = now;
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1];
}

// описания вкусов из Supabase (запрос идёт параллельно со шрифтами и сценой, при сбое остаются тексты из data.js)
const catalogReady = loadCatalog();

async function boot() {
  progress(0.06);
  try {
    await Promise.all([
      document.fonts.load('820 40px "Roboto Flex Variable"', 'ДжедесDiscover'),
      document.fonts.load('400 16px "Roboto Flex Variable"', 'Премиальный табак'),
    ]);
  } catch { /* продолжаем с системными шрифтами */ }
  progress(0.2);
  if (applyCatalog(FLAVORS, await catalogReady)) showFlavor(flavorIdx); // новые тексты вкусов показываем сразу
  await nextFrame();

  try {
    sc = await createScene($('#gl'), { lowPower, light: forcedLight });
    progress(0.4);
    await nextFrame();
    await loadSkinAssets(sc.renderer);
    sc.jar.setSkin('brand');
    progress(0.5);
    // всё, что понадобится при первом скролле, готовим под заставкой
    await warmSkins(['brand'], sc.renderer, { immediate: true });
    progress(0.65);
    await warmSkins([FLAVORS[0].id, ...neighbours(0)], sc.renderer, { immediate: true });
    progress(0.88);
    await sc.compile();
    progress(0.94);
  } catch (err) {
    console.error('WebGL недоступен, показываем статичную версию', err);
    root.classList.add('no-webgl');
    sc = null;
  }

  // фото планет подгружаются по очереди в простое: к линейке вкусов они уже на видеокарте
  if (sc) {
    const queue = [10, ...FLAVORS.map((_, i) => i)]; // сначала планета упаковки: она нужна раньше всех
    const next = () => { if (queue.length) { sc.planets.get(queue.shift()); setTimeout(next, 700); } };
    setTimeout(next, 2500);
  }

  measure();
  requestAnimationFrame(frame);
  await nextFrame();
  await nextFrame();
  progress(0.97);
  // замер под заставкой: слабой видеокарте упрощаем сцену до того, как пользователь что-либо увидит
  if (sc && !forcedLight && !forcedFull && !document.hidden) {
    for (let pass = 0; pass < 3; pass++) {
      const ms = await medianFrameMs(36);
      if (ms == null || ms <= 27 || sc.lightLevel >= 3) break; // около 37 кадров/с и выше: всё в порядке
      sc.enterLightMode(ms > 60 ? 3 : sc.lightLevel + 1);
    }
  }
  progress(1);

  const t0 = performance.now();
  while (loader.shown < 0.995 && performance.now() - t0 < 2500) await nextFrame();
  await new Promise((r) => setTimeout(r, 200));

  loader.finished = true;
  el.loader.classList.add('done');
  setTimeout(() => el.loader.remove(), 900);

  initReveals(reduced);
  initForm();

  if (store.get('gds-18') === '1') setTimeout(startIntro, 250);
  else setTimeout(showGate, 350);
}

addEventListener('pointermove', (e) => {
  pointer.tx = (e.clientX / innerWidth) * 2 - 1;
  pointer.ty = -((e.clientY / innerHeight) * 2 - 1);
}, { passive: true });

boot();

if (import.meta.env.DEV) window.__gds = { cur, L: () => L, scrollToY, targets, intro, get sc() { return sc; } };

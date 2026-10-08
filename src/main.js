import './style.css';
import gsap from 'gsap';
import Lenis from 'lenis';
import * as THREE from 'three';
import { BRAND, FLAVORS, SKINS } from './data.js';
import { nb, typografDOM } from './typo.js';
import { buildMarquee, initCursor, initForm, initMagnetic, initReveals, initTilt } from './ui.js';
import { createScene } from './scene.js';
import { loadSkinAssets, prewarmSkins } from './skins.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  if (b === a) return x >= b ? 1 : 0;
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const pad = (n) => String(n).padStart(2, '0');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

// ── окружение ──────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('reduced');
const coarse = matchMedia('(pointer: coarse)').matches;
const lowPower = coarse || (navigator.hardwareConcurrency || 8) <= 4 || params.has('low');
const forcedQuality = params.has('q') ? Number(params.get('q')) : null;
const DT_MAX = Number(params.get('dtmax')) || 0.05; // верхняя граница шага времени (для отладки на медленных машинах)
if (reduced) document.documentElement.classList.add('reduced');

const el = {
  loader: $('#loader'), fill: $('#ld-fill'), pct: $('#ld-pct'),
  gate: $('#gate'), nav: $('#nav'),
  product: $('#product'), flavors: $('#flavors'), blend: $('#blend'), partners: $('#partners'), contact: $('#contact'),
  chapters: $$('.chapter'), dots: $$('.dots i'),
  fIdx: $('#f-idx'), fName: $('#f-name'), fRu: $('#f-ru'), fDesc: $('#f-desc'), fAstro: $('#f-astro'), fList: $('#f-list'),
  fPrev: $('#f-prev'), fNext: $('#f-next'),
  callouts: $('#callouts'), orbitLabels: $('#orbit-labels'),
  marquee: $('#marquee-track'),
  navLinks: $$('.nav-links a[data-sec]'), rail: $$('.rail button'),
};

el.nav.classList.add('away');
el.product.style.height = `calc(${el.product.dataset.screens} * 100svh)`;
el.flavors.style.height = `calc(${1 + FLAVORS.length * 0.55} * 100svh)`;

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

// ── текст: типографика и слова-маски для заголовков ────────────────
typografDOM(document.body);
$$('[data-split]').forEach((h) => {
  const text = h.textContent.trim();
  h.setAttribute('aria-label', text);
  h.textContent = '';
  text.split(' ').forEach((w, i, arr) => {
    const outer = document.createElement('span');
    outer.className = 'word';
    outer.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('i');
    inner.textContent = w;
    outer.append(inner);
    h.append(outer);
    if (i < arr.length - 1) h.append(' ');
  });
});
if (!reduced) gsap.set('[data-line]', { yPercent: 118 });
gsap.ticker.lagSmoothing(3000, 33); // на тяжёлых кадрах анимации не должны замедляться

// ── статические элементы, зависящие от данных ──────────────────────
buildMarquee(el.marquee);

FLAVORS.forEach((f, i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = f.star;
  b.dataset.i = String(i);
  li.append(b);
  el.fList.append(li);
});
const fButtons = $$('button', el.fList);
const swapEls = [el.fName, el.fRu, el.fDesc, el.fAstro];
swapEls.forEach((e) => e.classList.add('f-swap'));

const orbitLabels = FLAVORS.map((f) => {
  const d = document.createElement('div');
  d.className = 'orbit-label';
  d.textContent = f.star;
  el.orbitLabels.append(d);
  return d;
});
const orbPos = [];

const calloutDefs = [{ k: 'lid', t: 'Термо-полусфера' }, { k: 'body', t: 'Обечайка' }, { k: 'base', t: '25 г табака' }];
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
  el.callouts.append(d);
  return { ...c, node: d, p: { x: 0, y: 0 } };
});

// ── плавный скролл ─────────────────────────────────────────────────
let lenis = null;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95 });
  lenis.stop();
}
function scrollToY(y, dur = 1.8) {
  if (lenis) lenis.scrollTo(y, { duration: dur, easing: (t) => 1 - Math.pow(1 - t, 4) });
  else window.scrollTo({ top: y, behavior: 'smooth' });
}

// ── раскладка ──────────────────────────────────────────────────────
let L = { vh: innerHeight, prodTop: 0, prodH: 1, flavTop: 0, flavH: 1, blendTop: 0, partnersTop: 0, contactTop: 0, docH: 1 };
function measure() {
  const top = (e) => e.getBoundingClientRect().top + window.scrollY;
  const vh = $('.pin', el.product).offsetHeight || window.innerHeight || 720;
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
const flash = { v: 0 };
const spin = { v: 0 };
const cur = {
  time: 0, dt: 0.016, fly: 0, warp: 0, px: 0, py: 0, intro: 0, flash: 0, co: 0,
  tint: new THREE.Color(BRAND.a),
  moonRim: new THREE.Color('#e9c871'),
  moon: { x: 3.4, y: -4, z: -12, s: 5.2, a: 0 },
  horizon: { y: -29, a: 0 },
  star: { x: 10, y: 0.6, z: -17, s: 1.7, vis: 0, hot: GOLD_HOT.clone(), cool: GOLD_COOL.clone() },
  jar: { x: 2.35, y: -3, s: 0.6, ry: 0, rx: 0.36, rz: -0.22, vis: false },
  ring: { vis: 0, rot: 0, active: 0 },
};
const tintTarget = new THREE.Color(BRAND.a);
const hotTarget = GOLD_HOT.clone();
const coolTarget = GOLD_COOL.clone();
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let skinId = 'brand';
let flavorIdx = 0;
let ringTarget = 0;
let swapTimer = 0;
let accentReset = false;
let prevY = 0;
let chapter = 0;
let section = '';
let sc = null;

function showFlavor(i) {
  const f = FLAVORS[i];
  fButtons.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  swapEls.forEach((e) => e.classList.add('out'));
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => {
    el.fIdx.textContent = pad(i + 1);
    el.fName.textContent = f.star;
    el.fRu.textContent = nb(f.ru);
    el.fDesc.textContent = nb(f.desc);
    el.fAstro.replaceChildren();
    const rows = f.astro
      ? [['Звезда', `${f.astro.bayer} · ${f.astro.sky}`], ['Расстояние', f.astro.dist]]
      : [['Линейка', `Stellar · № ${i + 1}`]];
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
  }, reduced ? 0 : 260);
}

function setAccent(skin) {
  document.documentElement.style.setProperty('--accent', skin.a);
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
  if (!instant && !reduced) {
    gsap.fromTo(flash, { v: 1 }, { v: 0, duration: 1.4, ease: 'power2.out' });
  }
  if (instant || reduced) { sc.jar.setSkin(id); return; }
  gsap.killTweensOf(spin);
  const start = spin.v;
  let swapped = false;
  gsap.to(spin, {
    v: start + Math.PI * 2, duration: 1.2, ease: 'power3.inOut',
    onUpdate() {
      if (!swapped && spin.v > start + Math.PI) { swapped = true; sc.jar.setSkin(id); }
    },
    onComplete() { sc.jar.setSkin(id); prewarmSkins(neighbours(flavorIdx), sc.renderer); },
  });
}

function setFlavor(i) {
  if (i === flavorIdx && skinId === FLAVORS[i].id) return;
  const n = FLAVORS.length;
  const delta = ((((i - flavorIdx + n / 2) % n) + n) % n) - n / 2;
  ringTarget -= delta * ((Math.PI * 2) / n);
  flavorIdx = i;
  cur.ring.active = i;
  showFlavor(i);
  goSkin(FLAVORS[i].id);
}
showFlavor(0);

function flavorY(i) {
  return L.flavTop + ((i + 0.5) / FLAVORS.length) * (L.flavH - L.vh);
}
fButtons.forEach((b) => b.addEventListener('click', () => scrollToY(flavorY(Number(b.dataset.i)), 1.3)));
const stepFlavor = (d) => {
  const n = FLAVORS.length;
  const i = clamp(flavorIdx + d, 0, n - 1);
  if (i !== flavorIdx) scrollToY(flavorY(i), 1.3);
};
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
  if (id === 'product') y = L.prodTop + L.vh * 0.1;
  else if (id === 'flavors') y = L.flavTop + L.vh * 0.2;
  else if (id !== 'hero') y = (el[id] || $(`#${id}`)).getBoundingClientRect().top + window.scrollY;
  scrollToY(y);
}));

// ── цели анимации по скроллу ───────────────────────────────────────
function targets(y) {
  const { vh } = L;
  const aspect = innerWidth / innerHeight;
  const narrow = aspect < 0.95;
  const hero = sstep(0, vh * 0.9, y);
  const prodP = clamp((y - L.prodTop) / Math.max(1, L.prodH - vh));
  const flavT = sstep(L.flavTop - vh * 0.55, L.flavTop + vh * 0.05, y);
  const flavP = clamp((y - L.flavTop) / Math.max(1, L.flavH - vh));
  const flavEnd = L.flavTop + L.flavH - vh;
  const exit = sstep(flavEnd, flavEnd + vh * 0.95, y);
  const horizon = sstep(L.contactTop - vh * 1.3, L.contactTop - vh * 0.1, y);
  const iv = 1 - Math.pow(1 - cur.intro, 3); // ease-out
  const c = narrow ? 0 : -0.3;

  const t = { prodP, flavT, flavP, exit, hero, narrow };

  // луна: в хиро — большая, снизу справа; дальше уходит влево-вверх
  t.moon = narrow
    ? { x: lerp(0.6, -10, hero), y: lerp(-4.4, 3, hero) - (1 - iv) * 2, z: lerp(-12, -30, hero), s: 4.2, a: 1 - hero }
    : { x: lerp(3.5, -10, hero), y: lerp(-3.6, 3, hero) - (1 - iv) * 2.4, z: lerp(-12, -30, hero), s: lerp(5.2, 4.4, hero) * lerp(0.92, 1, iv), a: (1 - hero) * clamp(iv * 1.6) };
  t.horizon = { y: lerp(-29, -19, horizon), a: horizon };

  // звезда: за краем луны в хиро → тускнеет в упаковке → встаёт за банкой в линейке
  const sHero = narrow ? { x: 7, y: 0.4, z: -17, s: 0.9, k: 1.5 } : { x: 9.1, y: 1.5, z: -17, s: 1.15, k: 1.5 };
  const sProd = { x: -12.5, y: 6.8, z: -26, s: 0.55, k: 0.5 };
  const sFlav = narrow ? { x: 0.4, y: 2.2, z: -18, s: 2.1, k: 0.55 } : { x: 3.6, y: 0.3, z: -18, s: 2.7, k: 0.55 };
  const a = (p, q, k) => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), z: lerp(p.z, q.z, k), s: lerp(p.s, q.s, k), k: lerp(p.k, q.k, k) });
  const s1 = a(sHero, sProd, hero);
  const s2 = a(s1, sFlav, flavT);
  t.star = { ...s2, vis: s2.k * (1 - exit) * clamp(iv * 1.4) };

  // банка
  const sway = Math.sin(cur.time * 0.45) * 0.5 + pointer.x * 0.35;
  const swayAmp = lerp(1, 0.3, hero);
  const prodEnd = Math.PI * 2 + c;
  t.jar = {
    x: narrow ? 0 : lerp(1.8, 1.9, hero),
    y: (narrow ? lerp(1.4, 1.25, hero) : 0) + exit * 8 - (1 - iv) * 1.2,
    s: (narrow ? 0.62 : 1.12) * lerp(0.5, 1, iv) * (1 + exit * 0.9),
    ry: lerp(0, prodEnd, prodP) + sway * swayAmp + exit * Math.PI * 1.2,
    rx: 0.36 - pointer.y * 0.08,
    rz: lerp(-0.22, -0.12, flavT),
    vis: iv > 0.02 && exit < 0.998,
  };
  t.ringVis = sstep(L.flavTop - vh * 0.2, L.flavTop + vh * 0.25, y) * (1 - exit) * (narrow ? 0.6 : 1);
  return t;
}

// ── главный цикл ───────────────────────────────────────────────────
let last = performance.now();
const perf = { acc: 0, n: 0, warm: 150 };
const tmpP = { x: 0, y: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, DT_MAX);
  last = now;
  lenis?.raf(now);
  const y = window.scrollY;
  const vel = (y - prevY) / Math.max(dt, 0.001);
  prevY = y;
  cur.time += dt;
  cur.dt = dt;
  cur.intro = intro.v;
  cur.flash = flash.v;

  const k = (n) => 1 - Math.exp(-dt * n);
  pointer.x = lerp(pointer.x, pointer.tx, k(4));
  pointer.y = lerp(pointer.y, pointer.ty, k(4));
  const t = targets(y);

  cur.fly = lerp(cur.fly, clamp(y / Math.max(1, L.docH - L.vh)), k(5));
  cur.warp = lerp(cur.warp, clamp(Math.abs(vel) / 4200), k(4));
  cur.px = pointer.x;
  cur.py = pointer.y;
  cur.tint.lerp(tintTarget, k(3));

  for (const key of ['x', 'y', 'z', 's', 'a']) cur.moon[key] = lerp(cur.moon[key], t.moon[key], k(6));
  for (const key of ['y', 'a']) cur.horizon[key] = lerp(cur.horizon[key], t.horizon[key], k(5));
  for (const key of ['x', 'y', 'z', 's', 'vis']) cur.star[key] = lerp(cur.star[key], t.star[key], k(5));
  cur.star.hot.lerp(hotTarget, k(3));
  cur.star.cool.lerp(coolTarget, k(3));
  for (const key of ['x', 'y', 's', 'ry', 'rx', 'rz']) cur.jar[key] = lerp(cur.jar[key], t.jar[key], k(key === 'ry' ? 5 : 6));
  cur.jar.vis = t.jar.vis;
  cur.ring.vis = lerp(cur.ring.vis, t.ringVis, k(5));
  cur.ring.rot = lerp(cur.ring.rot, ringTarget, k(4.5));

  // какая «шкура» у банки
  const inFlavors = t.flavT > 0.5 && !(t.exit > 0.6);
  if (!t.jar.vis) { goSkin('brand', true); accentReset = false; }
  else if (inFlavors) {
    setFlavor(Math.min(FLAVORS.length - 1, Math.floor(t.flavP * FLAVORS.length)));
    if (accentReset) { accentReset = false; setAccent(SKINS[skinId]); }
  } else if (t.exit > 0.6) {
    // банка улетает: цвет страницы возвращается к золоту, пока она ещё в кадре
    if (!accentReset) { accentReset = true; setAccent(BRAND); }
  } else if (t.flavT <= 0.5) goSkin('brand');

  // главы «Упаковки»
  const ch = Math.min(2, Math.floor(t.prodP * 3));
  if (ch !== chapter) {
    chapter = ch;
    el.chapters.forEach((c, i) => c.classList.toggle('on', i === ch));
    el.dots.forEach((d, i) => d.classList.toggle('on', i === ch));
  }

  // текущий раздел → навигация и рейка
  const marks = [['hero', 0], ['product', L.prodTop], ['flavors', L.flavTop], ['blend', L.blendTop], ['partners', L.partnersTop], ['contact', L.contactTop]];
  let sec = 'hero';
  for (const [id, top] of marks) if (y >= top - L.vh * 0.5) sec = id;
  if (sec !== section) {
    section = sec;
    el.navLinks.forEach((a) => (a.dataset.sec === sec ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    el.rail.forEach((b) => (b.dataset.sec === sec ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  }

  if (sc) {
    sc.update({ ...cur, jar: { ...cur.jar, ry: cur.jar.ry + spin.v } });

    // метки орбиты
    if (cur.ring.vis > 0.04) {
      sc.orbScreen(orbPos);
      orbitLabels.forEach((lab, i) => {
        const p = orbPos[i];
        const on = i === flavorIdx;
        lab.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - 5).toFixed(1)}px, 0)`;
        const edge = p.x > innerWidth - 120 || p.x < 24 ? 0 : 1;
        lab.style.opacity = (cur.ring.vis * edge * (on ? 1 : 0.12 + 0.5 * p.d)).toFixed(3);
        lab.classList.toggle('on', on);
      });
    } else if (orbitLabels[0].style.opacity !== '0') {
      orbitLabels.forEach((lab) => { lab.style.opacity = '0'; });
    }

    // выноски на банке — только во второй главе «Упаковки», на широком экране
    const wantCo = chapter === 1 && t.jar.vis && !t.narrow && t.flavT < 0.3 ? 1 : 0;
    cur.co = lerp(cur.co, wantCo, k(6));
    callouts.forEach((c, i) => {
      if (cur.co < 0.01) { if (c.node.style.opacity !== '0') c.node.style.opacity = '0'; return; }
      sc.anchorScreen(c.k, tmpP);
      c.node.style.transform = `translate3d(${tmpP.x.toFixed(1)}px, ${tmpP.y.toFixed(1)}px, 0) translate(-100%, -50%)`;
      c.node.style.opacity = (cur.co * (1 - i * 0.04)).toFixed(3);
    });

    // регулятор качества: если кадры тяжёлые — упрощаем сцену
    if (forcedQuality == null) {
      if (perf.warm > 0) perf.warm -= 1;
      else {
        perf.acc += dt;
        perf.n += 1;
        if (perf.n >= 90) {
          const avg = perf.acc / perf.n;
          perf.acc = 0;
          perf.n = 0;
          if (avg > 0.032 && sc.level > 0) { sc.setQuality(sc.level - 1); perf.warm = 60; }
        }
      }
    }
  }
}

// ── возрастной экран и запуск ──────────────────────────────────────
let introStarted = false;
function startIntro() {
  if (introStarted) return;
  introStarted = true;
  document.body.classList.remove('is-locked');
  lenis?.start();
  el.nav.classList.remove('away');
  if (reduced) return;
  gsap.to(intro, { v: 1, duration: 3, ease: 'power2.out' });
  gsap.to('[data-line]', { yPercent: 0, duration: 1.6, ease: 'expo.out', stagger: 0.12, delay: 0.3 });
  gsap.to('#hero [data-intro]', { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.4, ease: 'expo.out', stagger: 0.12, delay: 0.8, onComplete() { $$('#hero [data-intro]').forEach((n) => { n.style.filter = 'none'; }); } });
  gsap.from('.marquee', { opacity: 0, duration: 1.6, delay: 1.4, ease: 'power2.out' });
}

const inertTargets = [$('#main'), $('.footer'), el.nav, $('#rail')];
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
  setTimeout(() => { el.gate.hidden = true; }, 1100);
  startIntro();
});
$('#gate-no').addEventListener('click', () => { $('#gate-deny').hidden = false; });

async function boot() {
  progress(0.06);
  try {
    await Promise.all([
      document.fonts.load('600 40px "Unbounded Variable"', 'ДжедесDiscover'),
      document.fonts.load('500 16px "Manrope Variable"', 'Премиальный табак'),
      document.fonts.load('700 12px "Manrope Variable"', 'КУПАЖ'),
    ]);
  } catch { /* продолжаем с системными шрифтами */ }
  progress(0.22);
  await nextFrame();

  try {
    sc = await createScene($('#gl'), { lowPower, quality: forcedQuality });
    progress(0.45);
    await nextFrame();
    await loadSkinAssets(sc.renderer);
    sc.jar.setSkin('brand');
    progress(0.68);
    await nextFrame();
    await sc.compile();
    progress(0.9);
  } catch (err) {
    console.error('WebGL недоступен, показываем статичную версию', err);
    document.documentElement.classList.add('no-webgl');
    sc = null;
  }

  measure();
  requestAnimationFrame(frame);
  await nextFrame();
  await nextFrame();
  progress(1);
  if (sc) prewarmSkins(neighbours(0).concat(FLAVORS[0].id), sc.renderer);

  const t0 = performance.now();
  while (loader.shown < 0.995 && performance.now() - t0 < 2500) await nextFrame();
  await new Promise((r) => setTimeout(r, 250));

  loader.finished = true;
  el.loader.classList.add('done');
  setTimeout(() => el.loader.remove(), 1400);

  initCursor($('.cursor'));
  initMagnetic();
  initTilt();
  initReveals(reduced);
  initForm();

  if (store.get('gds-18') === '1') setTimeout(startIntro, 350);
  else setTimeout(showGate, 450);
}

addEventListener('pointermove', (e) => {
  pointer.tx = (e.clientX / innerWidth) * 2 - 1;
  pointer.ty = -((e.clientY / innerHeight) * 2 - 1);
}, { passive: true });

boot();

if (import.meta.env.DEV) window.__gds = { cur, L: () => L, scrollToY, targets, gsap, intro, get sc() { return sc; } };

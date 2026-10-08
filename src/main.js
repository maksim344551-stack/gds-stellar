import './style.css';
import gsap from 'gsap';
import Lenis from 'lenis';
import * as THREE from 'three';
import { BRAND, FLAVORS, SKINS } from './data.js';
import { createScene } from './scene.js';
import { loadSkinAssets } from './skins.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => {
  if (b === a) return x >= b ? 1 : 0;
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const pad = (n) => String(n).padStart(2, '0');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const lowPower = coarse || (navigator.hardwareConcurrency || 8) <= 4;
if (reduced) document.documentElement.classList.add('reduced');

// ── элементы ──────────────────────────────────────────────────────
const el = {
  nav: $('#nav'), hero: $('#hero'), product: $('#product'), flavors: $('#flavors'),
  blend: $('#blend'), partners: $('#partners'), contact: $('#contact'),
  chapters: $$('.chapter'), dots: $$('.dots i'),
  fIdx: $('#f-idx'), fName: $('#f-name'), fRu: $('#f-ru'), fDesc: $('#f-desc'), fList: $('#f-list'),
  glow: $('.cursor-glow'),
};
el.product.style.height = `calc(${el.product.dataset.screens} * 100svh)`;
el.flavors.style.height = `calc(${1 + FLAVORS.length * 0.55} * 100svh)`;

// ── слова для анимации заголовков ──────────────────────────────────
$$('[data-split]').forEach((h) => {
  if (h.hasAttribute('data-line')) return;
  const text = h.textContent.trim();
  h.setAttribute('aria-label', text);
  h.textContent = '';
  text.split(/\s+/).forEach((w, i, arr) => {
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

// ── список вкусов ──────────────────────────────────────────────────
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
const swapEls = [el.fName, el.fRu, el.fDesc];
swapEls.forEach((e) => e.classList.add('f-swap'));

// ── возрастной экран ───────────────────────────────────────────────
const gate = $('#gate');
let introPlayed = false;
function playIntro() {
  if (introPlayed) return;
  introPlayed = true;
  if (reduced) { $$('[data-reveal]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; }); return; }
  gsap.to('[data-line]', { yPercent: 0, duration: 1.5, ease: 'expo.out', stagger: 0.12, delay: 0.25 });
  gsap.to('#hero [data-reveal]', { opacity: 1, y: 0, duration: 1.2, ease: 'power3.out', stagger: 0.12, delay: 0.7 });
}
function openSite() {
  gate.classList.add('hide');
  document.body.classList.remove('is-locked');
  lenis?.start();
  playIntro();
}
let lenis = null;
if (store.get('gds-18') === '1') {
  gate.classList.add('hide');
  document.body.classList.remove('is-locked');
  setTimeout(playIntro, 200);
} else {
  lenis?.stop();
}
$('#gate-yes').addEventListener('click', () => { store.set('gds-18', '1'); openSite(); });
$('#gate-no').addEventListener('click', () => { $('#gate-deny').hidden = false; });

// ── плавный скролл ─────────────────────────────────────────────────
if (!reduced) {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95, smoothTouch: false });
  if (!gate.classList.contains('hide')) lenis.stop();
}

// ── 3D ─────────────────────────────────────────────────────────────
let sc = null;
try {
  const canvas = $('#gl');
  sc = await createScene(canvas, { lowPower });
  await loadSkinAssets(sc.renderer);
  sc.jar.setSkin('brand');
} catch (err) {
  console.error('WebGL недоступен, показываем статичную версию', err);
  document.documentElement.classList.add('no-webgl');
  sc = null;
}

// ── раскладка ──────────────────────────────────────────────────────
let L = {};
function measure() {
  const top = (e) => e.getBoundingClientRect().top + window.scrollY;
  // 100svh может быть 0, пока вкладка скрыта, — тогда берём высоту окна
  const vh = $('.pin', el.product).offsetHeight || window.innerHeight || 720;
  L = {
    vh,
    prodTop: top(el.product), prodH: el.product.offsetHeight,
    flavTop: top(el.flavors), flavH: el.flavors.offsetHeight,
    contactTop: top(el.contact),
    docH: document.documentElement.scrollHeight,
  };
}
measure();
addEventListener('resize', measure);
addEventListener('load', measure);
document.fonts?.ready.then(measure);

// ── состояние ──────────────────────────────────────────────────────
const cur = {
  time: 0, fly: 0, warp: 0, px: 0, py: 0,
  tint: new THREE.Color(BRAND.a),
  planet: { x: 3.6, y: -1.0, z: -10, s: 4.5, a: 1 },
  horizon: { y: -29, z: -20, s: 15, a: 0 },
  jar: { x: 1.9, y: -7, s: 0.5, ry: -Math.PI * 1.1, rx: 0.38, rz: -0.22, vis: false },
  ring: { vis: 0, rot: 0, active: 0 },
};
const tintTarget = new THREE.Color(BRAND.a);
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
const spin = { v: 0 };
let skinId = 'brand';
let flavorIdx = 0;
let ringTarget = 0;
let swapTimer = 0;
let prevY = 0;

function showFlavor(i) {
  const f = FLAVORS[i];
  fButtons.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  swapEls.forEach((e) => e.classList.add('out'));
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => {
    el.fIdx.textContent = pad(i + 1);
    el.fName.textContent = f.star;
    el.fRu.textContent = f.ru;
    el.fDesc.textContent = f.desc;
    swapEls.forEach((e) => e.classList.remove('out'));
  }, reduced ? 0 : 240);
}

function setAccent(skin) {
  document.documentElement.style.setProperty('--accent', skin.a);
  tintTarget.set(skin.a);
}

function goSkin(id, instant = false) {
  if (id === skinId) return;
  skinId = id;
  setAccent(SKINS[id]);
  if (!sc) return;
  if (instant || reduced) { sc.jar.setSkin(id); return; }
  gsap.killTweensOf(spin);
  const start = spin.v;
  let swapped = false;
  gsap.to(spin, {
    v: start + Math.PI * 2, duration: 1.15, ease: 'power3.inOut',
    onUpdate() {
      if (!swapped && spin.v > start + Math.PI) { swapped = true; sc.jar.setSkin(id); }
    },
    onComplete() { sc.jar.setSkin(id); },
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

fButtons.forEach((b) => b.addEventListener('click', () => {
  const i = Number(b.dataset.i);
  const y = L.flavTop + ((i + 0.5) / FLAVORS.length) * (L.flavH - L.vh);
  scrollToY(y, 1.2);
}));

function scrollToY(y, dur = 1.6) {
  if (lenis) lenis.scrollTo(y, { duration: dur, easing: (t) => 1 - Math.pow(1 - t, 4) });
  else window.scrollTo({ top: y, behavior: 'smooth' });
}
$$('[data-go]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const id = a.dataset.go;
  const target = el[id] || $('#' + id);
  let y = target.getBoundingClientRect().top + window.scrollY;
  if (id === 'flavors') y += L.vh * 0.2;
  if (id === 'product') y += L.vh * 0.1;
  scrollToY(y);
}));

// ── цели анимации по скроллу ───────────────────────────────────────
function targets(y) {
  const { vh } = L;
  const aspect = innerWidth / innerHeight;
  const narrow = aspect < 0.95;
  const enter = sstep(L.prodTop - vh * 0.85, L.prodTop + vh * 0.15, y);
  const prodP = clamp((y - L.prodTop) / Math.max(1, L.prodH - vh));
  const toFlav = sstep(L.flavTop - vh * 0.55, L.flavTop + vh * 0.05, y);
  const flavP = clamp((y - L.flavTop) / Math.max(1, L.flavH - vh));
  const flavEnd = L.flavTop + L.flavH - vh;
  const exit = sstep(flavEnd, flavEnd + vh * 0.95, y);
  const hero = sstep(0, vh * 0.95, y);
  const horizon = sstep(L.contactTop - vh * 1.3, L.contactTop - vh * 0.1, y);

  const t = { prodP, flavP, enter, toFlav, exit };
  t.planet = narrow
    ? { x: lerp(1.1, -10, hero), y: lerp(-2.4, 4, hero), z: lerp(-11, -30, hero), s: 3.6, a: 1 - hero }
    : { x: lerp(3.7, -10, hero), y: lerp(-1.0, 4, hero), z: lerp(-10, -30, hero), s: 4.5, a: 1 - hero };
  t.horizon = { y: lerp(-29, -19, horizon), z: -20, s: 15, a: horizon };
  const sway = pointer.x * 0.32 + Math.sin(cur.time * 0.55) * 0.1;
  t.jar = {
    x: narrow ? 0 : 1.9,
    y: (narrow ? 1.25 : 0) + (1 - enter) * -7 + exit * 8,
    s: lerp(0.55, 1, enter) * (narrow ? 0.66 : 1.12) * (1 + exit * 0.9),
    ry: (1 - enter) * -Math.PI * 1.1 + prodP * Math.PI * 1.8 + toFlav * (Math.PI * 0.2 - (narrow ? 0 : 0.3)) + exit * Math.PI * 1.2 + sway,
    rx: 0.36 - pointer.y * 0.08,
    rz: lerp(-0.22, -0.12, toFlav),
    vis: enter > 0.002 && exit < 0.998,
  };
  t.ringVis = sstep(L.flavTop - vh * 0.2, L.flavTop + vh * 0.25, y) * (1 - exit) * (narrow ? 0.62 : 1);
  return t;
}

// ── главный цикл ───────────────────────────────────────────────────
let last = performance.now();
let chapter = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lenis?.raf(now);
  const y = window.scrollY;
  const vel = (y - prevY) / Math.max(dt, 0.001);
  prevY = y;
  cur.time += dt;

  pointer.x = lerp(pointer.x, pointer.tx, 1 - Math.exp(-dt * 4));
  pointer.y = lerp(pointer.y, pointer.ty, 1 - Math.exp(-dt * 4));
  const t = targets(y);
  const k = (n) => 1 - Math.exp(-dt * n);

  cur.fly = lerp(cur.fly, clamp(y / Math.max(1, L.docH - L.vh)), k(5));
  cur.warp = lerp(cur.warp, clamp(Math.abs(vel) / 4200), k(4));
  cur.px = pointer.x;
  cur.py = pointer.y;
  cur.tint.lerp(tintTarget, k(3));

  for (const key of ['x', 'y', 'z', 's', 'a']) cur.planet[key] = lerp(cur.planet[key], t.planet[key], k(6));
  for (const key of ['y', 'z', 's', 'a']) cur.horizon[key] = lerp(cur.horizon[key], t.horizon[key], k(5));
  for (const key of ['x', 'y', 's', 'ry', 'rx', 'rz']) cur.jar[key] = lerp(cur.jar[key], t.jar[key], k(key === 'ry' ? 5 : 6));
  cur.jar.vis = t.jar.vis;
  cur.ring.vis = lerp(cur.ring.vis, t.ringVis, k(5));
  cur.ring.rot = lerp(cur.ring.rot, ringTarget, k(4.5));

  // выбор состояния банки по прогрессу
  const inFlavors = t.toFlav > 0.5 && !(t.exit > 0.6);
  if (!t.jar.vis) {
    goSkin('brand', true);
  } else if (inFlavors) {
    setFlavor(Math.min(FLAVORS.length - 1, Math.floor(t.flavP * FLAVORS.length)));
  } else if (t.toFlav <= 0.5) {
    goSkin('brand');
  }

  // главы «Упаковки»
  const ch = Math.min(2, Math.floor(t.prodP * 3));
  if (ch !== chapter) {
    chapter = ch;
    el.chapters.forEach((c, i) => c.classList.toggle('on', i === ch));
    el.dots.forEach((d, i) => d.classList.toggle('on', i === ch));
  }
  el.nav.classList.toggle('solid', y > 40);

  if (sc) sc.update({ ...cur, jar: { ...cur.jar, ry: cur.jar.ry + spin.v }, time: cur.time });
}

// ── указатель ──────────────────────────────────────────────────────
addEventListener('pointermove', (e) => {
  pointer.tx = (e.clientX / innerWidth) * 2 - 1;
  pointer.ty = -((e.clientY / innerHeight) * 2 - 1);
  if (!coarse) el.glow.style.transform = `translate3d(${e.clientX - 280}px, ${e.clientY - 280}px, 0)`;
}, { passive: true });

// ── карточки с 3D-наклоном ─────────────────────────────────────────
if (!coarse && !reduced) {
  $$('.sort, .perk').forEach((card) => {
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3.out' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3.out' });
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      ry((nx - 0.5) * 12);
      rx(-(ny - 0.5) * 12);
      card.style.setProperty('--mx', `${nx * 100}%`);
      card.style.setProperty('--my', `${ny * 100}%`);
    });
    card.addEventListener('pointerleave', () => { rx(0); ry(0); });
  });
}

// ── появление блоков ───────────────────────────────────────────────
if (!reduced) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const t = en.target;
      io.unobserve(t);
      if (t.matches('[data-split]')) {
        gsap.from($$('.word > i', t), { yPercent: 115, duration: 1.2, ease: 'expo.out', stagger: 0.07 });
      } else {
        gsap.to(t, { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out', delay: (Number([...t.parentNode.children].indexOf(t)) % 4) * 0.08 });
      }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
  $$('[data-split]').forEach((e) => { if (!e.closest('.chapter')) io.observe(e); });
  $$('[data-reveal]').forEach((e) => { if (!e.closest('.hero')) io.observe(e); });
}

// ── форма заявки (без бэкенда: открывает почтовый клиент) ───────────
const form = $('#lead-form');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  const contact = String(fd.get('contact') || '').trim();
  const consent = form.elements.consent.checked;
  [form.elements.name, form.elements.contact].forEach((i) => i.classList.toggle('invalid', !i.value.trim()));
  const note = $('#form-note');
  if (!name || !contact || !consent) {
    note.textContent = 'Заполните имя, контакт и подтвердите согласие.';
    return;
  }
  const body = [
    `Имя: ${name}`,
    `Компания: ${String(fd.get('company') || '').trim()}`,
    `Город: ${String(fd.get('city') || '').trim()}`,
    `Контакт: ${contact}`,
    '',
    String(fd.get('message') || '').trim(),
  ].join('\n');
  const href = `mailto:Mtechno.tobacco@gmail.com?subject=${encodeURIComponent('Заявка на сотрудничество GDS')}&body=${encodeURIComponent(body)}`;
  note.textContent = 'Открываем почтовый клиент с готовым письмом…';
  window.location.href = href;
});

requestAnimationFrame(frame);
if (import.meta.env.DEV) window.__gds = { cur, L: () => L, scrollToY, targets, gsap };

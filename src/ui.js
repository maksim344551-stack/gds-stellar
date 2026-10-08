import gsap from 'gsap';
import { FLAVORS } from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Бегущая строка с названиями звёзд: две одинаковые половины для бесшовной петли. */
export function buildMarquee(track) {
  const half = () => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    FLAVORS.forEach((f) => {
      const s = document.createElement('span');
      s.textContent = f.star;
      wrap.append(s);
    });
    return wrap;
  };
  track.append(half(), half());
}

/** Курсор-кольцо: плавно догоняет указатель, увеличивается над кнопками и ссылками. */
export function initCursor(el) {
  if (matchMedia('(pointer: coarse)').matches) return;
  let x = -100;
  let y = -100;
  let tx = -100;
  let ty = -100;
  addEventListener('pointermove', (e) => {
    tx = e.clientX;
    ty = e.clientY;
    el.classList.add('on');
  }, { passive: true });
  document.addEventListener('pointerleave', () => el.classList.remove('on'));
  const hot = 'a, button, input, textarea, label, [data-go], .tilt';
  document.addEventListener('pointerover', (e) => el.classList.toggle('hot', !!e.target.closest?.(hot)));
  const loop = () => {
    x += (tx - x) * 0.22;
    y += (ty - y) * 0.22;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    requestAnimationFrame(loop);
  };
  loop();
}

/** Магнитные кнопки: сдвиг задаётся CSS-переменными, плавность даёт transition. */
export function initMagnetic() {
  if (matchMedia('(pointer: coarse)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('.btn').forEach((b) => {
    b.style.transform = 'translate(var(--tx, 0px), var(--ty, 0px))';
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.setProperty('--tx', `${((e.clientX - r.left) / r.width - 0.5) * 12}px`);
      b.style.setProperty('--ty', `${((e.clientY - r.top) / r.height - 0.5) * 8}px`);
    });
    b.addEventListener('pointerleave', () => {
      b.style.setProperty('--tx', '0px');
      b.style.setProperty('--ty', '0px');
    });
    b.addEventListener('pointerdown', () => { b.style.transform = 'translate(var(--tx, 0px), var(--ty, 0px)) scale(0.97)'; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => b.addEventListener(t, () => { b.style.transform = 'translate(var(--tx, 0px), var(--ty, 0px))'; }));
  });
}

/** Карточки с 3D-наклоном и подсветкой за курсором. */
export function initTilt() {
  if (matchMedia('(pointer: coarse)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('.tilt').forEach((card) => {
    const core = $('.core', card);
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.7, ease: 'power3.out' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.7, ease: 'power3.out' });
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      ry((nx - 0.5) * 9);
      rx(-(ny - 0.5) * 9);
      core.style.setProperty('--mx', `${nx * 100}%`);
      core.style.setProperty('--my', `${ny * 100}%`);
    });
    card.addEventListener('pointerleave', () => { rx(0); ry(0); });
  });
}

/** Появление блоков при прокрутке: плавный подъём с проявлением из размытия. */
export function initReveals(reduced) {
  if (reduced) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const t = en.target;
      io.unobserve(t);
      if (t.matches('[data-split]')) {
        gsap.from($$('.word > i', t), { yPercent: 118, duration: 1.3, ease: 'expo.out', stagger: 0.07 });
      } else {
        const idx = [...t.parentNode.children].indexOf(t);
        gsap.to(t, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, ease: 'expo.out', delay: (idx % 4) * 0.09, onComplete: () => { t.style.filter = 'none'; } });
      }
    });
  }, { threshold: 0.16, rootMargin: '0px 0px -6% 0px' });
  $$('[data-split]').forEach((e) => { if (!e.closest('.chapter')) io.observe(e); });
  $$('[data-reveal]').forEach((e) => io.observe(e));
}

/** Форма заявки: бэкенда нет — открывает почтовый клиент с готовым письмом. */
export function initForm() {
  const form = $('#lead-form');
  const note = $('#form-note');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const contact = String(fd.get('contact') || '').trim();
    const consent = form.elements.consent.checked;
    [form.elements.name, form.elements.contact].forEach((i) => i.classList.toggle('invalid', !i.value.trim()));
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
}

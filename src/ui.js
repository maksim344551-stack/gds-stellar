import arrowLeft from '@phosphor-icons/core/assets/light/arrow-left-light.svg?raw';
import arrowRight from '@phosphor-icons/core/assets/light/arrow-right-light.svg?raw';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ICONS = { 'arrow-left': arrowLeft, 'arrow-right': arrowRight };

/** Иконки Phosphor (Light) подставляются из собранных SVG-файлов пакета, не из пользовательских данных. */
export function hydrateIcons() {
  $$('[data-icon]').forEach((el) => {
    const svg = ICONS[el.dataset.icon];
    if (!svg) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = svg.trim();
    const node = tpl.content.firstElementChild;
    node.setAttribute('aria-hidden', 'true');
    node.removeAttribute('width');
    node.removeAttribute('height');
    el.replaceChildren(node);
  });
}

/** Блоки проявляются один раз, когда попадают в экран: смещение и прозрачность, без размытия. */
export function initReveals(reduced) {
  const items = $$('[data-reveal]');
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach((e) => e.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const t = en.target;
      io.unobserve(t);
      const idx = [...t.parentNode.children].filter((c) => c.hasAttribute('data-reveal')).indexOf(t);
      t.style.transitionDelay = `${Math.max(0, idx) * 0.07}s`;
      t.classList.add('in');
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
  items.forEach((e) => io.observe(e));
}

/** Форма заявки: бэкенда нет, поэтому по отправке открывается почтовый клиент с готовым письмом. */
export function initForm() {
  const form = $('#lead-form');
  const note = $('#form-note');
  const rules = [
    { input: form.elements.name, err: $('#e-name'), ok: (i) => i.value.trim() !== '', text: 'Укажите имя' },
    { input: form.elements.contact, err: $('#e-contact'), ok: (i) => i.value.trim() !== '', text: 'Укажите телефон или e-mail' },
    { input: form.elements.consent, err: $('#e-consent'), ok: (i) => i.checked, text: 'Подтвердите согласие, чтобы отправить заявку' },
  ];
  const show = (r, bad) => {
    r.err.textContent = bad ? r.text : '';
    if (bad) r.input.setAttribute('aria-invalid', 'true');
    else r.input.removeAttribute('aria-invalid');
  };
  rules.forEach((r) => {
    r.input.addEventListener('input', () => { if (r.ok(r.input)) show(r, false); });
    r.input.addEventListener('change', () => { if (r.ok(r.input)) show(r, false); });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bad = rules.filter((r) => !r.ok(r.input));
    rules.forEach((r) => show(r, bad.includes(r)));
    if (bad.length) {
      note.textContent = '';
      bad[0].input.focus();
      return;
    }
    const fd = new FormData(form);
    const val = (k) => String(fd.get(k) || '').trim();
    const body = [
      `Имя: ${val('name')}`,
      `Компания: ${val('company')}`,
      `Город: ${val('city')}`,
      `Контакт: ${val('contact')}`,
      '',
      val('message'),
    ].join('\n');
    const href = `mailto:Mtechno.tobacco@gmail.com?subject=${encodeURIComponent('Заявка на сотрудничество GDS')}&body=${encodeURIComponent(body)}`;
    note.textContent = 'Открываем почтовый клиент с готовым письмом.';
    window.location.href = href;
  });
}

import arrowLeft from '@phosphor-icons/core/assets/light/arrow-left-light.svg?raw';
import arrowRight from '@phosphor-icons/core/assets/light/arrow-right-light.svg?raw';
import { sendLead, leadEndpoint } from './lead.js';

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

// Куда уходит письмо, если прямая отправка недоступна: почтовая программа посетителя открывается с готовым письмом.
const FALLBACK_MAIL = 'maksim344551@gmail.com';
const MAIL_MESSAGE_MAX = 600;
const PHONE = ['8', '800', '300', '4999'].join(String.fromCharCode(160)); // с неразрывными пробелами

/**
 * Форма заявки. Заявка уходит на почту владельца через Google Apps Script (src/lead.js). Если адрес приложения
 * не задан или связи нет, открывается почтовая программа посетителя с готовым письмом, как раньше.
 */
export function initForm() {
  const form = $('#lead-form');
  const note = $('#form-note');
  const button = $('button[type="submit"]', form);
  form.hidden = false; // без JavaScript форма остаётся скрытой (см. noscript в index.html)
  const opened = performance.now();
  const rules = [
    { input: form.elements.name, err: $('#e-name'), ok: (i) => i.value.trim() !== '', text: 'Укажите имя' },
    { input: form.elements.contact, err: $('#e-contact'), ok: (i) => i.value.trim() !== '', text: 'Укажите телефон или e-mail' },
    { input: form.elements.consent, err: $('#e-consent'), ok: (i) => i.checked, text: 'Подтвердите согласие, чтобы отправить заявку' },
    { input: form.elements.trade, err: $('#e-trade'), ok: (i) => i.checked, text: 'Подтвердите возраст и вид деятельности, чтобы отправить заявку' },
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

  const openMail = (lead) => {
    // длинные ссылки mailto: почтовые программы обрезают, поэтому в письмо идёт не больше MAIL_MESSAGE_MAX знаков сообщения
    const cut = lead.message.length > MAIL_MESSAGE_MAX;
    const body = [
      `Имя: ${lead.name}`,
      `Компания: ${lead.company}`,
      `Город: ${lead.city}`,
      `Контакт: ${lead.contact}`,
      '',
      cut ? `${lead.message.slice(0, MAIL_MESSAGE_MAX)}…` : lead.message,
      ...(cut ? ['', `(Сообщение сокращено до ${MAIL_MESSAGE_MAX} знаков: допишите остальное.)`] : []),
      '',
      'Согласие на обработку персональных данных и подтверждение, что мне есть 18 лет и я представляю юридическое лицо или ИП, торгующее табачной продукцией, даны на сайте.',
    ].join('\n');
    const href = `mailto:${FALLBACK_MAIL}?subject=${encodeURIComponent('Заявка на сотрудничество GDS')}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    // на телефоне без настроенной почты ничего не откроется: через пару секунд подсказываем, что делать
    setTimeout(() => {
      if (!document.hidden) note.textContent = `Если почтовая программа не открылась, напишите на ${FALLBACK_MAIL} или позвоните ${PHONE}.`;
    }, 2200);
  };

  // что сказать посетителю, если сервер не принял заявку по понятной причине
  const REFUSALS = {
    rate_limited: `Слишком много заявок за короткое время. Попробуйте позже или позвоните ${PHONE}.`,
    too_fast: 'Проверьте данные и нажмите «Отправить заявку» ещё раз.',
    'invalid_input:contact': 'Проверьте телефон или e-mail: он не похож на настоящий.',
    'invalid_input:name': 'Проверьте имя: оно пустое или слишком длинное.',
    'invalid_input:message': 'Сообщение слишком длинное: сократите его, пожалуйста.',
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    const bad = rules.filter((r) => !r.ok(r.input));
    rules.forEach((r) => show(r, bad.includes(r)));
    if (bad.length) {
      note.textContent = '';
      bad[0].input.focus();
      return;
    }
    const fd = new FormData(form);
    const val = (k) => String(fd.get(k) || '').trim();
    const lead = {
      name: val('name'),
      company: val('company'),
      city: val('city'),
      contact: val('contact'),
      message: val('message'),
      consent: true,
      trade: true,
      hp: val('hp'),
      t: Math.round(performance.now() - opened),
    };

    if (!leadEndpoint) {
      note.textContent = 'Открываем почтовый клиент с готовым письмом.';
      openMail(lead);
      return;
    }

    button.disabled = true;
    note.textContent = 'Отправляем заявку…';
    const res = await sendLead(lead);
    button.disabled = false;
    if (res.ok) {
      form.reset();
      note.textContent = 'Заявка отправлена. Мы свяжемся с вами.';
      return;
    }
    if (REFUSALS[res.error]) {
      note.textContent = REFUSALS[res.error];
      return;
    }
    // нет связи, сбой сервера или неизвестный ответ: заявку не теряем, отправляем письмом из почтовой программы
    note.textContent = 'Не удалось отправить заявку напрямую. Открываем почтовую программу с готовым письмом.';
    openMail(lead);
  });
}

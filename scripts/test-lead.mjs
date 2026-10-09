// Проверка приёма заявок без Google: apps-script/lead-mailer.gs запускается с подставными сервисами Apps Script,
// src/lead.js с подставным fetch. Запуск: node --test scripts/test-lead.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { sendLead, leadEndpoint } from '../src/lead.js';

const SCRIPT = fs.readFileSync(new URL('../apps-script/lead-mailer.gs', import.meta.url), 'utf8');

function makeScript({ quota = 100 } = {}) {
  const mails = [];
  const store = new Map();
  const errors = [];
  const ctx = {
    console: { error: (m) => errors.push(String(m)), log() {} },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
    MailApp: {
      sendEmail: (to, subject, body, options) => mails.push({ to, subject, body, options }),
      getRemainingDailyQuota: () => quota,
    },
    CacheService: { getScriptCache: () => ({ get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (algo, s) => [...crypto.createHash('sha256').update(String(s)).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
      formatDate: (d, tz, fmt) => (fmt === 'yyyyMMddHH' ? d.toISOString().slice(0, 13).replace(/[-T]/g, '') : '01.01.2026 12:00'),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).content);
  return { ctx, mails, errors, post };
}

const good = (over = {}) => ({
  name: 'Иван Петров', company: 'ООО Ромашка', city: 'Казань', contact: 'ivan@example.com',
  message: 'Хотим обсудить поставки.', consent: true, trade: true, website: '', t: 9000, ...over,
});

test('правильная заявка: одно письмо владельцу, ответ ok', () => {
  const s = makeScript();
  assert.deepEqual(s.post(good()), { ok: true });
  assert.equal(s.mails.length, 1);
  const m = s.mails[0];
  assert.equal(m.to, 'owner@example.test');
  assert.equal(m.subject, 'Заявка с сайта GDS: Иван Петров (ООО Ромашка)');
  assert.match(m.body, /Имя: Иван Петров/);
  assert.match(m.body, /Контакт: ivan@example\.com/);
  assert.match(m.body, /Хотим обсудить поставки\./);
  assert.equal(m.options.replyTo, 'ivan@example.com');
});

test('телефон вместо почты: письмо уходит без replyTo', () => {
  const s = makeScript();
  assert.deepEqual(s.post(good({ contact: '+7 (900) 123-45-67' })), { ok: true });
  assert.equal(s.mails[0].options.replyTo, undefined);
  assert.match(s.mails[0].body, /перезвоните/);
});

test('ловушка для ботов: ответ ok, письма нет', () => {
  const s = makeScript();
  assert.deepEqual(s.post(good({ website: 'http://spam.example' })), { ok: true });
  assert.equal(s.mails.length, 0);
});

test('без согласия или без подтверждения 18+ заявка отклоняется', () => {
  const s = makeScript();
  assert.equal(s.post(good({ consent: false })).error, 'invalid_input:consent');
  assert.equal(s.post(good({ trade: undefined })).error, 'invalid_input:trade');
  assert.equal(s.mails.length, 0);
});

test('слишком быстрая отправка и отсутствие времени заполнения', () => {
  const s = makeScript();
  assert.equal(s.post(good({ t: 500 })).error, 'too_fast');
  assert.equal(s.post(good({ t: undefined })).error, 'invalid_input:t');
  assert.equal(s.post(good({ t: 1e12 })).error, 'invalid_input:t');
  assert.equal(s.mails.length, 0);
});

test('контакт обязателен и должен быть почтой или телефоном', () => {
  const s = makeScript();
  assert.equal(s.post(good({ contact: '' })).error, 'invalid_input:contact');
  assert.equal(s.post(good({ contact: 'просто слова' })).error, 'invalid_input:contact');
  assert.equal(s.post(good({ contact: 'a@b.com, evil@x.com' })).error, 'invalid_input:contact');
  assert.equal(s.post(good({ contact: '(((((' })).error, 'invalid_input:contact');
  assert.equal(s.post(good({ contact: '88003004999' })).ok, true);
});

test('имя обязательно, длины ограничены', () => {
  const s = makeScript();
  assert.equal(s.post(good({ name: '   ' })).error, 'invalid_input:name');
  assert.equal(s.post(good({ name: 'я'.repeat(121) })).error, 'invalid_input:name');
  assert.equal(s.post(good({ message: 'я'.repeat(2001) })).error, 'invalid_input:message');
  assert.equal(s.post(good({ company: 'я'.repeat(121) })).error, 'invalid_input:company');
});

test('перевод строки в имени не попадает в тему письма (нет внедрения заголовков)', () => {
  const s = makeScript();
  s.post(good({ name: 'Иван\r\nBcc: evil@example.com' }));
  assert.equal(s.mails.length, 1);
  assert.ok(!/[\r\n]/.test(s.mails[0].subject));
  assert.equal(s.mails[0].subject, 'Заявка с сайта GDS: Иван Bcc: evil@example.com (ООО Ромашка)');
  assert.equal(s.mails[0].options.replyTo, 'ivan@example.com');
});

test('невидимые знаки и знаки направления текста вырезаются', () => {
  const s = makeScript();
  const dirty = ['Ив', String.fromCharCode(0x200b), 'ан', String.fromCharCode(0x202e), String.fromCharCode(7)].join('');
  s.post(good({ name: dirty }));
  assert.match(s.mails[0].body, /Имя: Ив ан/);
  assert.ok(!/​|‮|\u0007/.test(s.mails[0].body));
});

test('сообщение сохраняет абзацы, переводы Windows приводятся к одному виду', () => {
  const s = makeScript();
  s.post(good({ message: 'Первая строка\r\nвторая\r\n\r\n\r\n\r\nтретья' }));
  assert.match(s.mails[0].body, /Первая строка\nвторая\n\nтретья/);
});

test('ограничение частоты: четвёртая заявка с одного контакта за час отклоняется', () => {
  const s = makeScript();
  for (let i = 0; i < 3; i++) assert.equal(s.post(good()).ok, true);
  assert.equal(s.post(good()).error, 'rate_limited');
  assert.equal(s.post(good({ contact: 'other@example.com' })).ok, true);
  assert.equal(s.mails.length, 4);
});

test('общий лимит в час', () => {
  const s = makeScript();
  let sent = 0;
  for (let i = 0; i < 40; i++) if (s.post(good({ contact: `u${i}@example.com` })).ok) sent++;
  assert.equal(sent, 30);
});

test('суточная квота почты исчерпана: ответ unavailable, письма нет', () => {
  const s = makeScript({ quota: 0 });
  assert.equal(s.post(good()).error, 'unavailable');
  assert.equal(s.mails.length, 0);
});

test('мусорный JSON и слишком большое тело', () => {
  const s = makeScript();
  assert.equal(s.post('{не json').error, 'unknown');
  assert.equal(s.post('x'.repeat(13000)).error, 'invalid_input:size');
  assert.equal(s.post('null').error, 'invalid_input:body');
  assert.equal(s.mails.length, 0);
});

test('GET отвечает проверкой работоспособности и не шлёт писем', () => {
  const s = makeScript();
  assert.deepEqual(JSON.parse(s.ctx.doGet().content), { ok: true, service: 'gds-leads' });
});

test('в коде скрипта нет адресов почты и внешних адресов', () => {
  assert.ok(!/@[a-z0-9-]+\.(com|ru|org)/i.test(SCRIPT.replace(/ivan@|a@/g, '')), 'нет зашитого адреса почты');
  assert.ok(!/https?:\/\//.test(SCRIPT), 'нет обращений на внешние адреса');
});

// ------------------------------------------------------------ клиент ---

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxTEST_id-123/exec';
const reply = (obj) => async () => ({ json: async () => obj });
const payload = { name: 'А', contact: 'a@b.cc', consent: true, trade: true, t: 5000 };

test('клиент: успешный ответ', async () => {
  assert.deepEqual(await sendLead(payload, { endpoint: ENDPOINT, fetchImpl: reply({ ok: true }) }), { ok: true });
});

test('клиент: коды ошибок сервера передаются как есть', async () => {
  assert.deepEqual(await sendLead(payload, { endpoint: ENDPOINT, fetchImpl: reply({ ok: false, error: 'rate_limited' }) }), { ok: false, error: 'rate_limited' });
  assert.deepEqual(await sendLead(payload, { endpoint: ENDPOINT, fetchImpl: reply({ ok: false }) }), { ok: false, error: 'unknown' });
});

test('клиент: сеть недоступна, неразборчивый ответ и таймаут дают network', async () => {
  assert.equal((await sendLead(payload, { endpoint: ENDPOINT, fetchImpl: async () => { throw new Error('offline'); } })).error, 'network');
  assert.equal((await sendLead(payload, { endpoint: ENDPOINT, fetchImpl: async () => ({ json: async () => { throw new Error('html'); } }) })).error, 'network');
  const hang = (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  const t0 = Date.now();
  assert.equal((await sendLead(payload, { endpoint: ENDPOINT, fetchImpl: hang, timeoutMs: 50 })).error, 'network');
  assert.ok(Date.now() - t0 < 1000);
});

test('клиент: без адреса приложения заявка не уходит (unavailable), а адрес в настройке пуст', async () => {
  assert.equal(leadEndpoint, null);
  let called = false;
  assert.equal((await sendLead(payload, { fetchImpl: async () => { called = true; return reply({ ok: true })(); } })).error, 'unavailable');
  assert.equal(called, false);
});

test('клиент: запрос простой для CORS, без cookie и без адреса страницы', async () => {
  let seen;
  await sendLead(payload, { endpoint: ENDPOINT, fetchImpl: async (u, init) => { seen = { u, init }; return { json: async () => ({ ok: true }) }; } });
  assert.equal(seen.u, ENDPOINT);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(seen.init.body), payload);
});

/**
 * GDS «Джедес»: приём партнёрских заявок с сайта. Google Apps Script, веб-приложение.
 *
 * Что делает: проверяет заявку, ограничивает частоту и присылает письмо на почту ВЛАДЕЛЬЦА
 * АККАУНТА, под которым развёрнуто приложение (адрес берётся из аккаунта, в коде его нет).
 * Ничего не хранит: ни таблицы, ни базы. Письмо в почтовом ящике единственная копия.
 *
 * Как развернуть: apps-script/README.md. Коротко: script.google.com, новый проект, вставить этот
 * файл, Deploy, New deployment, Web app, Execute as: Me, Who has access: Anyone.
 */

var CONFIG = {
  SENDER_NAME: 'Сайт GDS',
  // Отправитель «Я» (владелец), поэтому счётчик Gmail: на обычном аккаунте не больше 100 писем в сутки.
  MAX_PER_CONTACT_PER_HOUR: 3,
  MAX_TOTAL_PER_HOUR: 10,
  // Запас дневной почтовой квоты: ниже него заявки не принимаются (сайт откроет почту посетителя), а владельцу уходит
  // одно предупреждение (возможно, идёт рассылка спама).
  QUOTA_RESERVE: 30,
  // Человек не заполнит форму быстрее. Слишком быстрые отправки отклоняются (можно повторить).
  MIN_FILL_MS: 2500,
  MAX_FILL_MS: 6 * 60 * 60 * 1000,
  MAX_BODY_CHARS: 12000,
};

var LIMITS = { name: 120, company: 120, city: 80, contact: 120 };
var MESSAGE_LIMIT = 2000;
var EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
var PHONE_RE = /^[0-9+()\- ]{5,32}$/;

function doGet() {
  return json_({ ok: true, service: 'gds-leads' });
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > CONFIG.MAX_BODY_CHARS) return json_({ ok: false, error: 'invalid_input:size' });
    var request = JSON.parse(raw || '{}');

    // Ловушка для ботов: поле скрыто от людей. Притворяемся, что всё в порядке, письмо не шлём.
    if (request && request.hp) return json_({ ok: true });

    var lead = validate_(request);
    if (lead.error) return json_({ ok: false, error: lead.error });

    if (!withinRateLimit_(lead.contact)) return json_({ ok: false, error: 'rate_limited' });
    if (MailApp.getRemainingDailyQuota() < CONFIG.QUOTA_RESERVE) {
      warnQuota_();
      return json_({ ok: false, error: 'unavailable' });
    }

    send_(lead);
    return json_({ ok: true });
  } catch (err) {
    console.error('lead error: ' + (err && err.message ? err.message : err));
    return json_({ ok: false, error: 'unknown' });
  }
}

// ------------------------------------------------------------ проверка ---

// Убирает управляющие знаки. Однострочные поля сворачивают пробелы; keepLines сохраняет переводы строк.
function clean_(value, max, keepLines) {
  if (value === null || value === undefined) return '';
  var text = String(value).replace(/\r\n?/g, '\n');
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    var hidden = code < 32 || code === 127 || (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2064) ||
      (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;
    if (hidden && keepLines && (code === 10 || code === 13)) out += '\n';
    else out += hidden ? ' ' : text.charAt(i);
  }
  out = keepLines ? out.replace(/\n{3,}/g, '\n\n').trim() : out.replace(/\s+/g, ' ').trim();
  return out.length > max ? null : out;
}

function validate_(request) {
  if (!request || typeof request !== 'object') return { error: 'invalid_input:body' };
  if (request.consent !== true) return { error: 'invalid_input:consent' };
  if (request.trade !== true) return { error: 'invalid_input:trade' };

  var t = request.t;
  if (typeof t !== 'number' || !isFinite(t) || t > CONFIG.MAX_FILL_MS) return { error: 'invalid_input:t' };
  if (t < CONFIG.MIN_FILL_MS) return { error: 'too_fast' };

  var fields = {};
  for (var key in LIMITS) {
    var value = clean_(request[key], LIMITS[key], false);
    if (value === null) return { error: 'invalid_input:' + key };
    fields[key] = value;
  }
  if (!fields.name) return { error: 'invalid_input:name' };
  var message = clean_(request.message, MESSAGE_LIMIT, true);
  if (message === null) return { error: 'invalid_input:message' };

  var contact = fields.contact;
  var isEmail = EMAIL_RE.test(contact) && contact.length <= 254;
  var isPhone = PHONE_RE.test(contact) && /[0-9]/.test(contact);
  if (!isEmail && !isPhone) return { error: 'invalid_input:contact' };

  return {
    name: fields.name,
    company: fields.company,
    city: fields.city,
    contact: contact,
    contactIsEmail: isEmail,
    message: message,
  };
}

function withinRateLimit_(contact) {
  var cache = CacheService.getScriptCache();
  var hour = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
  var digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contact.toLowerCase()));
  var perContactKey = 'rl:' + hour + ':' + digest;
  var totalKey = 'rl:' + hour + ':all';
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var perContact = Number(cache.get(perContactKey) || 0) + 1;
    var total = Number(cache.get(totalKey) || 0) + 1;
    if (perContact > CONFIG.MAX_PER_CONTACT_PER_HOUR || total > CONFIG.MAX_TOTAL_PER_HOUR) return false;
    cache.put(perContactKey, String(perContact), 3600);
    cache.put(totalKey, String(total), 3600);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- письмо ---

function send_(lead) {
  var owner = Session.getEffectiveUser().getEmail();
  var when = Utilities.formatDate(new Date(), 'Europe/Moscow', 'dd.MM.yyyy HH:mm');
  var subject = 'Заявка с сайта GDS: ' + lead.name + (lead.company ? ' (' + lead.company + ')' : '');
  if (subject.length > 150) subject = subject.slice(0, 147) + '...';

  var body = [
    'Новая партнёрская заявка с сайта GDS «Джедес»',
    '',
    'Имя: ' + lead.name,
    'Компания: ' + (lead.company || 'не указана'),
    'Город: ' + (lead.city || 'не указан'),
    'Контакт: ' + lead.contact,
    '',
    'Сообщение:',
    lead.message || '(пусто)',
    '',
    '---',
    'Отправитель подтвердил на сайте: согласие на обработку персональных данных; ему есть 18 лет, он представляет юридическое лицо или ИП, торгующее табачной продукцией.',
    'Время (МСК): ' + when,
    lead.contactIsEmail ? 'Ответить на это письмо можно напрямую: адрес отправителя указан в «Ответить».' : 'Контакт указан телефоном: перезвоните.',
  ].join('\n');

  var options = { name: CONFIG.SENDER_NAME };
  if (lead.contactIsEmail) options.replyTo = lead.contact;
  MailApp.sendEmail(owner, subject, body, options);
}

// Одно предупреждение владельцу не чаще раза в шесть часов (максимум, на который хватает кеша Google).
function warnQuota_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('quota-warned')) return;
  cache.put('quota-warned', '1', 21600);
  try {
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Сайт GDS: почтовая квота почти исчерпана',
      'Заявки с сайта временно не принимаются через этот скрипт (посетители отправляют их из своей почтовой программы). Возможно, на форму идёт рассылка спама. Проверьте почту и журнал запусков в Apps Script; квота обновляется раз в сутки.'
    );
  } catch (err) {
    console.error('quota warning failed');
  }
}

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

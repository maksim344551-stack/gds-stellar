import { LEAD_ENDPOINT } from './config.js';

// Отправка партнёрской заявки в Google Apps Script (apps-script/lead-mailer.gs), который присылает письмо владельцу.
// Принимается только адрес развёрнутого веб-приложения Apps Script: опечатка в настройке не отправит заявки
// куда-то ещё. Если адрес не задан, форма работает по-старому: открывается почтовая программа посетителя.
const ENDPOINT_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
export const leadEndpoint = ENDPOINT_PATTERN.test(LEAD_ENDPOINT) ? LEAD_ENDPOINT : null;

/**
 * Возвращает { ok: true } или { ok: false, error }. error: unavailable (адрес не задан), network (нет связи,
 * таймаут, неразборчивый ответ), либо код от сервера: rate_limited, too_fast, invalid_input:<поле>, unknown.
 */
export async function sendLead(data, {
  fetchImpl = globalThis.fetch,
  endpoint = leadEndpoint,
  timeoutMs = 15000,
} = {}) {
  if (!endpoint || typeof fetchImpl !== 'function') return { ok: false, error: 'unavailable' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // text/plain оставляет запрос «простым» для CORS (без предварительного запроса, на который Apps Script не отвечает);
    // ответ приходит через перенаправление на script.googleusercontent.com, откуда его можно читать.
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data),
      signal: ctrl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    const json = await res.json();
    if (json && json.ok === true) return { ok: true };
    const code = json && typeof json.error === 'string' ? json.error.slice(0, 40) : 'unknown';
    return { ok: false, error: code };
  } catch {
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

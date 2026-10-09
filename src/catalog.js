import { SUPABASE_URL, SUPABASE_KEY, CATALOG_TIMEOUT_MS } from './config.js';

// Каталог из Supabase (таблица products, только чтение публичным ключом). Всё, что приходит из сети,
// считается данными: проверяется по форме, чистится от управляющих и невидимых знаков и попадает на
// страницу только через textContent (см. showFlavor в main.js), никогда как разметка.
// Что подставляется из базы: описание вкуса (description) по совпадению slug с id в data.js.
// Цвета, планеты, названия, подписи банки и астрономия остаются в data.js: в базе их нет.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Убираем управляющие знаки (кроме перевода строки), знаки нулевой ширины и управления направлением текста.
// Коды записаны числами, не невидимыми символами.
function isHidden(c) {
  return (c < 32 && c !== 10) || c === 127
    || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e)
    || (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
}
const clean = (s) => Array.from(s, (ch) => (isHidden(ch.codePointAt(0)) ? '' : ch)).join('').trim();

/** Строки ответа в Map(slug -> { description }). Негодная строка отбрасывается, а не ломает сайт. */
export function parseProducts(rows) {
  if (!Array.isArray(rows)) return null;
  const map = new Map();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const { slug, description } = r;
    if (typeof slug !== 'string' || slug.length > 64 || !SLUG.test(slug)) continue;
    if (typeof description !== 'string') continue;
    const text = clean(description);
    if (text === '' || text.length > 4000) continue;
    map.set(slug, { description: text });
  }
  return map;
}

/** Читает активные вкусы из базы. При любой ошибке или таймауте возвращает null (сайт покажет data.js). */
export async function loadCatalog({
  fetchImpl = globalThis.fetch,
  url = SUPABASE_URL,
  key = SUPABASE_KEY,
  timeoutMs = CATALOG_TIMEOUT_MS,
} = {}) {
  if (!url || !key || typeof fetchImpl !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${url}/rest/v1/products?select=slug,description&order=created_at.asc`, {
      headers: { apikey: key, Accept: 'application/json' },
      signal: ctrl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseProducts(await res.json());
  } catch (err) {
    console.warn('Каталог из базы недоступен, показаны встроенные тексты:', err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Подставляет описания из базы в существующие вкусы на месте (объекты общие с SKINS в data.js).
 * Возвращает, сколько вкусов изменилось. Вкусов, которых нет в data.js, сайт не создаёт: для каждого
 * нужны цвета и фото планеты. Скрытие вкуса через is_active пока сайтом не поддерживается.
 */
export function applyCatalog(flavors, catalog) {
  if (!catalog) return 0;
  let changed = 0;
  for (const f of flavors) {
    const row = catalog.get(f.id);
    if (row && row.description !== f.desc) {
      f.desc = row.description;
      changed += 1;
    }
  }
  return changed;
}

// Публичные значения для чтения каталога из Supabase. Это НЕ секреты: адрес проекта и
// publishable-ключ предназначены для браузера, а права ограничены политиками RLS в самой базе
// (supabase/migrations/002_rls.sql): посетитель может только читать активные строки.
// Секретные ключи (sb_secret_..., service_role) и пароль базы сюда нельзя ни при каких условиях.
// Другой проект подставляется при сборке: VITE_SUPABASE_URL и VITE_SUPABASE_KEY.
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://fwrnbirfenxnochdphpc.supabase.co';
export const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_KEY || 'sb_publishable_O97hUU8FQnJE0vbHDFpAcw_8g6uUTbW';

// Адрес веб-приложения Google Apps Script для партнёрских заявок (apps-script/README.md). Пока пусто, форма открывает
// почтовую программу посетителя, как раньше. Тоже публичное значение. Другой адрес при сборке: VITE_LEAD_ENDPOINT.
export const LEAD_ENDPOINT = import.meta.env?.VITE_LEAD_ENDPOINT || '';

// Сколько ждать ответ базы под заставкой. Если база недоступна, остаются тексты из data.js.
export const CATALOG_TIMEOUT_MS = 2000;

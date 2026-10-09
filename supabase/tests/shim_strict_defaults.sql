-- =============================================================================
-- shim_strict_defaults.sql: ТЕСТОВАЯ ЗАГЛУШКА. ЭТО НЕ SUPABASE.
-- =============================================================================
-- НЕ ВЫПОЛНЯТЬ В БОЕВОЙ БАЗЕ И В SUPABASE SQL EDITOR.
--
-- Дополнение к shim.sql. Выполняется ПОСЛЕ него и переключает песочницу в
-- «новый» режим платформы: новые таблицы и функции в схеме public НЕ выдаются
-- ролям anon, authenticated, service_role автоматически (так ведут себя
-- проекты Supabase, созданные с 30.05.2026 по умолчанию, и все проекты после
-- 30.10.2026; уже существующие таблицы права сохраняют: это даты из объявления
-- Supabase (changelog), на живом проекте не проверялись).
--
-- Зачем: миграции обязаны давать один и тот же итог в обоих режимах. Набор
-- тестов прогоняется и со старым режимом (shim.sql), и с этим.
-- =============================================================================

do $guard$
begin
  if current_setting('gds.sandbox_ack', true) is distinct from 'DISPOSABLE-SANDBOX-NOT-SUPABASE' then
    raise exception 'shim_strict_defaults.sql: отказ. Это тестовая заглушка, а не Supabase.';
  end if;
  if current_database() !~ '(^|[_-])(test|sandbox|tmp)($|[_-])' then
    raise exception 'shim_strict_defaults.sql: отказ. Имя базы должно содержать отдельным словом (через _ или -) test, sandbox или tmp.';
  end if;
end
$guard$;

begin;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
-- По умолчанию PostgreSQL даёт право вызова функций всем (PUBLIC); новый режим
-- Supabase это тоже отзывает.
alter default privileges for role postgres
  revoke execute on functions from public;

commit;

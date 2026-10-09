-- =============================================================================
-- 00_helpers.sql: помощники SQL-тестов. ТЕСТОВЫЙ ФАЙЛ, не для боевой базы.
-- =============================================================================
-- Создаёт схему gds_test с функцией gds_test.check(): она печатает строку
-- результата вида  RESULT|<id>|PASS|<описание>  или  RESULT|<id>|FAIL|<описание>.
-- Эти строки разбирает supabase/tests/run.mjs. Файл запускает run.mjs после
-- shim.sql и миграций.

do $guard$
begin
  if current_setting('gds.sandbox_ack', true) is distinct from 'DISPOSABLE-SANDBOX-NOT-SUPABASE' then
    raise exception '00_helpers.sql: отказ. Тесты запускаются только через supabase/tests/run.mjs на одноразовой базе.';
  end if;
  if current_database() !~ '(^|[_-])(test|sandbox|tmp)($|[_-])' then
    raise exception '00_helpers.sql: отказ. Имя базы должно содержать отдельным словом (через _ или -) test, sandbox или tmp.';
  end if;
end
$guard$;

create schema if not exists gds_test;

create or replace function gds_test.check(p_id text, p_ok boolean, p_desc text)
returns void
language plpgsql
as $$
begin
  raise notice 'RESULT|%|%|%',
    p_id,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end,
    p_desc;
end;
$$;

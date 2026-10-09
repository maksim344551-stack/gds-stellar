-- =============================================================================
-- window/01_after_001.test.sql: состояние базы СРАЗУ ПОСЛЕ 001_init.sql
-- (002 ещё не выполнялся). ТЕСТОВЫЙ ФАЙЛ, не для боевой базы.
-- =============================================================================
-- Между 001 и 002 владелец делает паузу, и таблицы не должны быть открыты.
-- Ожидается: политик нет (RLS без политик запрещает всё), служебных прав нет;
-- при режиме платформы со старыми правами по умолчанию роли могут иметь
-- SELECT/INSERT/UPDATE/DELETE на уровне таблицы, но RLS не показывает и не даёт
-- менять ни одной строки; при новом режиме прав нет вообще (отказ 42501).
-- run.mjs запускает этот файл один раз, между 001 и остальными миграциями.
-- =============================================================================

begin;

-- Фикстуры: по одной строке в таблицах (их создаёт суперпользователь).
insert into public.brands (id, name, full_name, country)
values ('11111111-1111-4111-8111-111111111111', 'W Brand', 'W Brand Full', 'Test');
insert into public.categories (id, name, slug)
values ('22222222-2222-4222-8222-222222222222', 'W Category', 'w-category');
insert into public.products (id, brand_id, category_id, name, slug, line, description)
values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 'W Product', 'w-product', 'L', 'D');
insert into public.product_images (product_id, image_url)
values ('33333333-3333-4333-8333-333333333333', 'https://example.test/w.jpg');
insert into public.stores (name, address, city, latitude, longitude)
values ('W Store', 'A', 'C', 1, 1);

do $$
declare
  n int; s text; v_rows int;
begin
  select count(*) into n from pg_policies where schemaname = 'public';
  perform gds_test.check('W00', n = 0, 'после 001 политик ещё нет: ' || n);

  perform gds_test.check('W01',
    not has_table_privilege('anon', 'public.products', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.products', 'TRUNCATE')
    and not has_any_column_privilege('anon', 'public.products', 'REFERENCES')
    and not has_table_privilege('anon', 'public.products', 'TRIGGER'),
    'после 001 служебные права (TRUNCATE, REFERENCES, TRIGGER) отозваны у anon и authenticated');

  -- anon: чтение не показывает ни одной строки (или отказ по правам); запись не проходит.
  set local role anon;
  s := 'ok'; begin select count(*) into n from public.products; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W02', (s = 'ok' and n = 0) or s = '42501',
    'после 001 anon не видит строк вкусов (код ' || s || ', строк ' || coalesce(n::text, 'нет') || ')');

  set local role anon;
  s := 'ok'; begin select count(*) into n from public.brands; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W03', (s = 'ok' and n = 0) or s = '42501', 'после 001 anon не видит строк брендов (код ' || s || ')');

  set local role anon;
  s := 'ok'; begin select count(*) into n from public.stores; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W04', (s = 'ok' and n = 0) or s = '42501', 'после 001 anon не видит строк точек (код ' || s || ')');

  set local role anon;
  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('HACK', 'HACK', 'HACK'); exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W05', s = '42501', 'после 001 anon не может вставить строку (42501): ' || s);

  -- UPDATE и DELETE: либо отказ по правам (новый режим платформы), либо 0 строк (RLS).
  set local role anon;
  s := 'ok'; v_rows := -1;
  begin update public.brands set name = 'HACKED' where true; get diagnostics v_rows = row_count; exception when others then s := sqlstate; v_rows := 0; end;
  reset role;
  perform gds_test.check('W06', v_rows = 0 and s in ('ok', '42501'), 'после 001 anon не может изменить строку: затронуто ' || v_rows || ', код ' || s);

  set local role anon;
  s := 'ok'; v_rows := -1;
  begin delete from public.products where true; get diagnostics v_rows = row_count; exception when others then s := sqlstate; v_rows := 0; end;
  reset role;
  perform gds_test.check('W07', v_rows = 0 and s in ('ok', '42501'), 'после 001 anon не может удалить строку: затронуто ' || v_rows || ', код ' || s);

  -- authenticated, даже с правдоподобным sub: то же самое.
  perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
  set local role authenticated;
  s := 'ok'; begin select count(*) into n from public.products; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W08', (s = 'ok' and n = 0) or s = '42501',
    'после 001 вошедший не видит строк вкусов (код ' || s || ')');

  set local role authenticated;
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description)
    values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'HACK', 'hack', 'L', 'D');
  exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W09', s = '42501', 'после 001 вошедший не может вставить вкус (42501): ' || s);

  set local role authenticated;
  s := 'ok'; v_rows := -1;
  begin update public.stores set name = 'HACKED' where true; get diagnostics v_rows = row_count; exception when others then s := sqlstate; v_rows := 0; end;
  reset role;
  perform gds_test.check('W10', v_rows = 0 and s in ('ok', '42501'), 'после 001 вошедший не может изменить точку: затронуто ' || v_rows || ', код ' || s);

  set local role authenticated;
  s := 'ok'; begin select count(*) into n from public.user_roles; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W11', (s = 'ok' and n = 0) or s = '42501', 'после 001 вошедший не видит user_roles (код ' || s || ')');
  perform set_config('request.jwt.claims', '', true);

  set local role anon;
  s := 'ok'; begin truncate public.products; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('W12', s = '42501', 'после 001 anon не может TRUNCATE (42501): ' || s);

  perform gds_test.check('W13', (select count(*) from public.products) = 1 and (select count(*) from public.brands) = 1,
    'после всех попыток данные на месте');
end $$;

rollback;

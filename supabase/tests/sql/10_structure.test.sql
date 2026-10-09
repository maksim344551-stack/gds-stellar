-- =============================================================================
-- 10_structure.test.sql: схема, ограничения, права, функции, политики.
-- ТЕСТОВЫЙ ФАЙЛ, не для боевой базы. Запускается из supabase/tests/run.mjs
-- после shim.sql, миграций 001-004 и 00_helpers.sql. Всё внутри транзакции,
-- которая в конце откатывается.
-- =============================================================================

begin;

-- S01: ровно шесть таблиц, лишних (цены, заказы, корзина) нет ---------------
do $$
declare n int;
begin
  select count(*) into n
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name in ('brands', 'categories', 'products', 'product_images', 'stores', 'user_roles');
  perform gds_test.check('S01a', n = 6, 'шесть нужных таблиц на месте: ' || n);

  select count(*) into n
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';
  perform gds_test.check('S01b', n = 6, 'в public ровно 6 таблиц, лишних нет: ' || n);
end $$;

-- S02: колонки, типы и nullable совпадают с ТЗ точно -------------------------
do $$
declare diff int;
begin
  with actual as (
    select table_name || '.' || column_name || ':'
           || case when data_type = 'numeric'
                   then 'numeric(' || numeric_precision || ',' || numeric_scale || ')'
                   else data_type end
           || ':' || is_nullable as s
    from information_schema.columns
    where table_schema = 'public'
  ),
  expected (s) as (values
    ('brands.id:uuid:NO'), ('brands.name:text:NO'), ('brands.full_name:text:NO'),
    ('brands.country:text:NO'), ('brands.description:text:YES'), ('brands.logo_url:text:YES'),
    ('brands.is_active:boolean:NO'), ('brands.created_at:timestamp with time zone:NO'),
    ('categories.id:uuid:NO'), ('categories.name:text:NO'), ('categories.slug:text:NO'),
    ('categories.created_at:timestamp with time zone:NO'),
    ('products.id:uuid:NO'), ('products.brand_id:uuid:NO'), ('products.category_id:uuid:NO'),
    ('products.name:text:NO'), ('products.slug:text:NO'), ('products.line:text:NO'),
    ('products.tagline:text:YES'), ('products.description:text:NO'),
    ('products.aroma_profile:text:YES'), ('products.weight_g:numeric(6,2):NO'),
    ('products.nicotine_mg:numeric(4,2):YES'), ('products.is_active:boolean:NO'),
    ('products.created_at:timestamp with time zone:NO'),
    ('products.updated_at:timestamp with time zone:YES'),
    ('product_images.id:uuid:NO'), ('product_images.product_id:uuid:NO'),
    ('product_images.image_url:text:NO'), ('product_images.sort_order:integer:NO'),
    ('stores.id:uuid:NO'), ('stores.name:text:NO'), ('stores.address:text:NO'),
    ('stores.city:text:NO'), ('stores.latitude:double precision:NO'),
    ('stores.longitude:double precision:NO'), ('stores.phone:text:YES'),
    ('stores.email:text:YES'), ('stores.working_hours:text:YES'),
    ('stores.is_active:boolean:NO'), ('stores.created_at:timestamp with time zone:NO'),
    ('user_roles.id:uuid:NO'), ('user_roles.role:text:NO'),
    ('user_roles.created_at:timestamp with time zone:NO')
  )
  select count(*) into diff from (
    (select s from actual except select s from expected)
    union all
    (select s from expected except select s from actual)
  ) d;
  perform gds_test.check('S02', diff = 0, 'колонки и типы совпадают с ТЗ, расхождений: ' || diff);
end $$;

-- S03: значения по умолчанию ------------------------------------------------
do $$
declare diff int;
begin
  with actual as (
    select table_name || '.' || column_name || '=' || column_default as s
    from information_schema.columns
    where table_schema = 'public' and column_default is not null
  ),
  expected (s) as (values
    ('brands.id=gen_random_uuid()'), ('brands.is_active=true'), ('brands.created_at=now()'),
    ('categories.id=gen_random_uuid()'), ('categories.created_at=now()'),
    ('products.id=gen_random_uuid()'), ('products.weight_g=25'), ('products.is_active=true'),
    ('products.created_at=now()'),
    ('product_images.id=gen_random_uuid()'), ('product_images.sort_order=0'),
    ('stores.id=gen_random_uuid()'), ('stores.is_active=true'), ('stores.created_at=now()'),
    ('user_roles.role=''admin''::text'), ('user_roles.created_at=now()')
  )
  select count(*) into diff from (
    (select s from actual except select s from expected)
    union all
    (select s from expected except select s from actual)
  ) d;
  perform gds_test.check('S03', diff = 0, 'значения по умолчанию совпадают с ТЗ, расхождений: ' || diff);
end $$;

-- S04: ключи, уникальность, внешние ключи и их on delete ---------------------
do $$
declare diff int; n int;
begin
  with actual as (
    select conname || ':' || contype::text || ':' ||
           case when contype = 'f' then confdeltype::text else '-' end as s
    from pg_constraint
    where connamespace = 'public'::regnamespace and contype in ('p', 'u', 'f')
  ),
  expected (s) as (values
    ('brands_pkey:p:-'), ('categories_pkey:p:-'), ('products_pkey:p:-'),
    ('product_images_pkey:p:-'), ('stores_pkey:p:-'), ('user_roles_pkey:p:-'),
    ('categories_slug_key:u:-'), ('products_slug_key:u:-'),
    ('products_brand_id_fkey:f:r'),          -- restrict (отступление от ТЗ, см. ADR)
    ('products_category_id_fkey:f:r'),       -- restrict (отступление от ТЗ, см. ADR)
    ('product_images_product_id_fkey:f:c'),  -- cascade, как в ТЗ
    ('user_roles_id_fkey:f:c')               -- cascade, как в ТЗ
  )
  select count(*) into diff from (
    (select s from actual except select s from expected)
    union all
    (select s from expected except select s from actual)
  ) d;
  perform gds_test.check('S04a', diff = 0, 'ключи и внешние ключи как задумано, расхождений: ' || diff);

  select count(*) into n from pg_constraint
  where conname = 'user_roles_id_fkey' and confrelid = 'auth.users'::regclass;
  perform gds_test.check('S04b', n = 1, 'user_roles.id ссылается на auth.users(id)');
end $$;

-- S05: ограничения CHECK: точный набор имён, все проверены ------------------
do $$
declare diff int; n int;
begin
  with actual as (
    select conname as s from pg_constraint
    where connamespace = 'public'::regnamespace and contype = 'c'
  ),
  expected (s) as (values
    ('brands_name_len'), ('brands_full_name_len'), ('brands_country_len'),
    ('brands_description_len'), ('brands_logo_url_https'),
    ('categories_name_len'), ('categories_slug_format'),
    ('products_slug_format'), ('products_name_len'), ('products_line_len'),
    ('products_tagline_len'), ('products_description_len'), ('products_aroma_len'),
    ('products_weight_range'), ('products_nicotine_range'),
    ('product_images_url_https'),
    ('stores_name_len'), ('stores_address_len'), ('stores_city_len'),
    ('stores_latitude_range'), ('stores_longitude_range'), ('stores_phone_format'),
    ('stores_email_format'), ('stores_hours_len'),
    ('user_roles_role_check')
  )
  select count(*) into diff from (
    (select s from actual except select s from expected)
    union all
    (select s from expected except select s from actual)
  ) d;
  perform gds_test.check('S05a', diff = 0, 'набор CHECK-ограничений как задумано, расхождений: ' || diff);

  select count(*) into n from pg_constraint
  where connamespace = 'public'::regnamespace and contype = 'c' and not convalidated;
  perform gds_test.check('S05b', n = 0, 'все CHECK проверены (validated), непроверенных: ' || n);
end $$;

-- S06: индексы из ТЗ ---------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_indexes
  where schemaname = 'public' and indexname in (
    'products_brand_id_idx', 'products_category_id_idx', 'products_is_active_idx',
    'product_images_product_id_idx', 'stores_is_active_idx');
  perform gds_test.check('S06a', n = 5, 'пять обычных индексов из ТЗ на месте: ' || n);

  select count(*) into n from pg_indexes
  where schemaname = 'public' and tablename = 'products'
    and indexdef ~ 'UNIQUE INDEX .*\(slug\)';
  perform gds_test.check('S06b', n = 1, 'индекс по products(slug) есть (его даёт unique), ровно один: ' || n);
end $$;

-- S07: триггер updated_at ----------------------------------------------------
do $$
declare
  n int;
  v_brand uuid; v_cat uuid; v_id uuid;
  v_updated timestamptz;
begin
  select count(*) into n from pg_trigger
  where tgrelid = 'public.products'::regclass and not tgisinternal
    and tgname = 'products_set_updated_at'
    and tgtype = 19;  -- 1 строчный + 2 BEFORE + 16 UPDATE
  perform gds_test.check('S07a', n = 1, 'триггер products_set_updated_at: BEFORE UPDATE, построчный');

  select count(*) into n from pg_trigger
  where tgrelid in ('public.brands'::regclass, 'public.categories'::regclass,
                    'public.product_images'::regclass, 'public.stores'::regclass,
                    'public.user_roles'::regclass) and not tgisinternal;
  perform gds_test.check('S07b', n = 0, 'на остальных таблицах пользовательских триггеров нет: ' || n);

  select id into v_brand from public.brands where name = 'GDS Джедес';
  select id into v_cat from public.categories where slug = 'hookah-tobacco';
  insert into public.products (brand_id, category_id, name, slug, line, description)
  values (v_brand, v_cat, 'Trigger Test', 'zz-trigger-test', 'Test', 'Test description')
  returning id, updated_at into v_id, v_updated;
  perform gds_test.check('S07c', v_updated is null, 'после INSERT updated_at пуст');

  update public.products set name = name where id = v_id;
  select updated_at into v_updated from public.products where id = v_id;
  perform gds_test.check('S07d', v_updated is null, 'UPDATE без изменений не трогает updated_at');

  update public.products set description = 'Test description 2' where id = v_id;
  select updated_at into v_updated from public.products where id = v_id;
  perform gds_test.check('S07e', v_updated is not null, 'реальный UPDATE ставит updated_at');

  update public.products set updated_at = '2001-01-01 00:00:00+00' where id = v_id;
  select updated_at into v_updated from public.products where id = v_id;
  perform gds_test.check('S07f', v_updated > '2020-01-01'::timestamptz,
    'руками updated_at подделать нельзя: триггер перезаписывает');
end $$;

-- S08: RLS включён на всех таблицах -----------------------------------------
do $$
declare n int;
begin
  select count(*) into n
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
  perform gds_test.check('S08', n = 6, 'RLS включён на всех 6 таблицах: ' || n);
end $$;

-- S09: функции is_admin и set_updated_at ------------------------------------
do $$
declare
  v_secdef boolean; v_cfg text[]; v_vol "char"; v_ret text; n int;
begin
  select p.prosecdef, p.proconfig, p.provolatile, p.prorettype::regtype::text
    into v_secdef, v_cfg, v_vol, v_ret
  from pg_proc p where p.oid = 'public.is_admin()'::regprocedure;

  perform gds_test.check('S09a', v_secdef, 'is_admin: SECURITY DEFINER');
  perform gds_test.check('S09b', v_cfg is not null and 'search_path=""' = any (v_cfg),
    'is_admin: фиксированный пустой search_path, конфиг: ' || coalesce(array_to_string(v_cfg, ','), 'нет'));
  perform gds_test.check('S09c', v_vol = 's', 'is_admin: STABLE');
  perform gds_test.check('S09d', v_ret = 'boolean', 'is_admin: возвращает boolean');
  perform gds_test.check('S09e', not has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'),
    'is_admin: у anon нет права вызова');
  perform gds_test.check('S09f', has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'),
    'is_admin: у authenticated есть право вызова');
  select count(*) into n
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = 'public.is_admin()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  perform gds_test.check('S09g', n = 0, 'is_admin: у PUBLIC нет права вызова');

  select p.proconfig into v_cfg from pg_proc p where p.oid = 'public.set_updated_at()'::regprocedure;
  perform gds_test.check('S09h', v_cfg is not null and 'search_path=""' = any (v_cfg),
    'set_updated_at: фиксированный пустой search_path');
  perform gds_test.check('S09i',
    not has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE'),
    'set_updated_at: у anon и authenticated нет права вызова');
  select count(*) into n
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = 'public.set_updated_at()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  perform gds_test.check('S09j', n = 0, 'set_updated_at: у PUBLIC нет права вызова');
end $$;

-- S10: расширение и состав схемы public -------------------------------------
do $$
declare v_schema text; n int;
begin
  select extnamespace::regnamespace::text into v_schema from pg_extension where extname = 'pgcrypto';
  perform gds_test.check('S10a', v_schema = 'extensions',
    'pgcrypto лежит в схеме extensions, а не в public: ' || coalesce(v_schema, 'не установлено'));

  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace;
  perform gds_test.check('S10b', n = 2, 'в public ровно две функции (is_admin, set_updated_at): ' || n);

  select count(*) into n from pg_views where schemaname = 'public';
  perform gds_test.check('S10c', n = 0, 'в public нет представлений (они обходят RLS): ' || n);
end $$;

-- S11: матрица прав на таблицы (итоговые права, с учётом ролей и PUBLIC) -----
do $$
declare diff int;
begin
  with actual as (
    select r, t, p
    from (values ('anon'), ('authenticated')) roles (r)
    cross join (values ('brands'), ('categories'), ('products'), ('product_images'), ('stores'), ('user_roles')) tabs (t)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privs (p)
    where has_table_privilege(r, format('public.%I', t)::regclass, p)
  ),
  expected (r, t, p) as (
    select 'anon', t, 'SELECT'
    from (values ('brands'), ('categories'), ('products'), ('product_images'), ('stores')) x (t)
    union all
    select 'authenticated', t, p
    from (values ('brands'), ('categories'), ('products'), ('product_images'), ('stores')) x (t)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) y (p)
    union all
    select 'authenticated', 'user_roles', 'SELECT'
  )
  select count(*) into diff from (
    (select r, t, p from actual except select r, t, p from expected)
    union all
    (select r, t, p from expected except select r, t, p from actual)
  ) d;
  perform gds_test.check('S11a', diff = 0,
    'права anon и authenticated на таблицы ровно такие, как задумано, расхождений: ' || diff);

  perform gds_test.check('S11b',
    has_table_privilege('service_role', 'public.products', 'SELECT')
    and has_table_privilege('service_role', 'public.products', 'INSERT')
    and has_table_privilege('service_role', 'public.products', 'UPDATE')
    and has_table_privilege('service_role', 'public.products', 'DELETE')
    and has_table_privilege('service_role', 'public.user_roles', 'SELECT'),
    'service_role имеет явные права SELECT/INSERT/UPDATE/DELETE');

  -- Права на отдельные колонки (has_any_column_privilege учитывает и права на таблицу целиком).
  with actual as (
    select r, t, p
    from (values ('anon'), ('authenticated')) roles (r)
    cross join (values ('brands'), ('categories'), ('products'), ('product_images'), ('stores'), ('user_roles')) tabs (t)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) privs (p)
    where has_any_column_privilege(r, format('public.%I', t)::regclass, p)
  ),
  expected (r, t, p) as (
    select 'anon', t, 'SELECT'
    from (values ('brands'), ('categories'), ('products'), ('product_images'), ('stores')) x (t)
    union all
    select 'authenticated', t, p
    from (values ('brands'), ('categories'), ('products'), ('product_images'), ('stores')) x (t)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE')) y (p)
    union all
    select 'authenticated', 'user_roles', 'SELECT'
  )
  select count(*) into diff from (
    (select r, t, p from actual except select r, t, p from expected)
    union all
    (select r, t, p from expected except select r, t, p from actual)
  ) d;
  perform gds_test.check('S11c', diff = 0,
    'права на колонки (SELECT, INSERT, UPDATE, REFERENCES) у anon и authenticated ровно такие, как задумано, расхождений: ' || diff);
end $$;

-- S11d: право MAINTAIN (появилось в PostgreSQL 17) у anon и authenticated отсутствует
do $$
declare t text; bad int := 0;
begin
  if current_setting('server_version_num')::int >= 170000 then
    foreach t in array array['brands', 'categories', 'products', 'product_images', 'stores', 'user_roles'] loop
      if has_table_privilege('anon', format('public.%I', t)::regclass, 'MAINTAIN')
         or has_table_privilege('authenticated', format('public.%I', t)::regclass, 'MAINTAIN') then
        bad := bad + 1;
      end if;
    end loop;
    perform gds_test.check('S11d', bad = 0, 'права MAINTAIN у anon и authenticated нет, таблиц с нарушением: ' || bad);
  else
    perform gds_test.check('S11d', true, 'права MAINTAIN в этой версии PostgreSQL нет (появилось в 17)');
  end if;
end $$;

-- S12: точный набор политик на таблицах public -------------------------------
do $$
declare diff int; n int;
begin
  with actual as (
    select tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || permissive as s
    from pg_policies where schemaname = 'public'
  ),
  expected (s) as (values
    ('brands|brands_public_read|SELECT|{anon,authenticated}|PERMISSIVE'),
    ('brands|brands_admin_read_all|SELECT|{authenticated}|PERMISSIVE'),
    ('brands|brands_admin_insert|INSERT|{authenticated}|PERMISSIVE'),
    ('brands|brands_admin_update|UPDATE|{authenticated}|PERMISSIVE'),
    ('brands|brands_admin_delete|DELETE|{authenticated}|PERMISSIVE'),
    ('categories|categories_public_read|SELECT|{anon,authenticated}|PERMISSIVE'),
    ('categories|categories_admin_insert|INSERT|{authenticated}|PERMISSIVE'),
    ('categories|categories_admin_update|UPDATE|{authenticated}|PERMISSIVE'),
    ('categories|categories_admin_delete|DELETE|{authenticated}|PERMISSIVE'),
    ('products|products_public_read|SELECT|{anon,authenticated}|PERMISSIVE'),
    ('products|products_admin_read_all|SELECT|{authenticated}|PERMISSIVE'),
    ('products|products_admin_insert|INSERT|{authenticated}|PERMISSIVE'),
    ('products|products_admin_update|UPDATE|{authenticated}|PERMISSIVE'),
    ('products|products_admin_delete|DELETE|{authenticated}|PERMISSIVE'),
    ('product_images|product_images_public_read|SELECT|{anon,authenticated}|PERMISSIVE'),
    ('product_images|product_images_admin_read_all|SELECT|{authenticated}|PERMISSIVE'),
    ('product_images|product_images_admin_insert|INSERT|{authenticated}|PERMISSIVE'),
    ('product_images|product_images_admin_update|UPDATE|{authenticated}|PERMISSIVE'),
    ('product_images|product_images_admin_delete|DELETE|{authenticated}|PERMISSIVE'),
    ('stores|stores_public_read|SELECT|{anon,authenticated}|PERMISSIVE'),
    ('stores|stores_admin_read_all|SELECT|{authenticated}|PERMISSIVE'),
    ('stores|stores_admin_insert|INSERT|{authenticated}|PERMISSIVE'),
    ('stores|stores_admin_update|UPDATE|{authenticated}|PERMISSIVE'),
    ('stores|stores_admin_delete|DELETE|{authenticated}|PERMISSIVE'),
    ('user_roles|user_roles_read_own|SELECT|{authenticated}|PERMISSIVE')
  )
  select count(*) into diff from (
    (select s from actual except select s from expected)
    union all
    (select s from expected except select s from actual)
  ) d;
  perform gds_test.check('S12a', diff = 0, 'набор политик public ровно такой, как задумано, расхождений: ' || diff);

  select count(*) into n from pg_policies
  where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (roles && array['anon', 'public']::name[]);
  perform gds_test.check('S12b', n = 0, 'нет политик записи для anon и PUBLIC: ' || n);

  select count(*) into n from pg_policies
  where schemaname = 'public' and policyname like '%admin%' and qual is not null and qual !~ 'is_admin'
    and cmd <> 'INSERT';
  perform gds_test.check('S12c', n = 0, 'каждая админская политика (using) вызывает is_admin: нарушений ' || n);

  select count(*) into n from pg_policies
  where schemaname = 'public' and policyname like '%admin_insert' and with_check !~ 'is_admin';
  perform gds_test.check('S12d', n = 0, 'каждая админская политика вставки (with check) вызывает is_admin: нарушений ' || n);
end $$;

-- C: ограничения значений (проверяет суперпользователь, RLS не мешает) ------
-- Ожидаемые коды: 23514 check_violation, 23505 unique_violation,
-- 23502 not_null_violation, 23503 foreign_key_violation,
-- 22003 numeric_value_out_of_range.

-- C1: categories и slug
do $$
declare s text;
begin
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'Bad'); exception when others then s := sqlstate; end;
  perform gds_test.check('C01', s = '23514', 'slug с заглавной буквой отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'bad slug'); exception when others then s := sqlstate; end;
  perform gds_test.check('C02', s = '23514', 'slug с пробелом отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', '-bad'); exception when others then s := sqlstate; end;
  perform gds_test.check('C03', s = '23514', 'slug с дефисом в начале отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'bad-'); exception when others then s := sqlstate; end;
  perform gds_test.check('C04', s = '23514', 'slug с дефисом в конце отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'bad--x'); exception when others then s := sqlstate; end;
  perform gds_test.check('C05', s = '23514', 'slug с двойным дефисом отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'плохой'); exception when others then s := sqlstate; end;
  perform gds_test.check('C06', s = '23514', 'slug кириллицей отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', ''); exception when others then s := sqlstate; end;
  perform gds_test.check('C07', s = '23514', 'пустой slug отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', repeat('a', 65)); exception when others then s := sqlstate; end;
  perform gds_test.check('C08', s = '23514', 'slug длиннее 64 символов отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'a' || E'\n'); exception when others then s := sqlstate; end;
  perform gds_test.check('C09', s = '23514', 'slug с переводом строки в конце отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'good-slug-1'); exception when others then s := sqlstate; end;
  perform gds_test.check('C10', s = 'ok', 'корректный slug принят: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('x', 'hookah-tobacco'); exception when others then s := sqlstate; end;
  perform gds_test.check('C11', s = '23505', 'повтор slug категории отклонён: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('', 'ok-name-1'); exception when others then s := sqlstate; end;
  perform gds_test.check('C12', s = '23514', 'пустое имя категории отклонено: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('   ', 'ok-name-2'); exception when others then s := sqlstate; end;
  perform gds_test.check('C13', s = '23514', 'имя категории из одних пробелов отклонено: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values (null, 'ok-name-3'); exception when others then s := sqlstate; end;
  perform gds_test.check('C14', s = '23502', 'имя категории null отклонено: ' || s);
end $$;

-- C2: products
do $$
declare
  s text;
  v_brand uuid; v_cat uuid;
begin
  select id into v_brand from public.brands where name = 'GDS Джедес';
  select id into v_cat from public.categories where slug = 'hookah-tobacco';

  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'Altair2', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C20', s = '23514', 'slug вкуса с заглавной отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'a_b', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C21', s = '23514', 'slug вкуса с подчёркиванием отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'altair', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C22', s = '23505', 'повтор slug вкуса отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, weight_g) values (v_brand, v_cat, 'T', 'zz-w0', 'L', 'D', 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C23', s = '23514', 'вес 0 отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, weight_g) values (v_brand, v_cat, 'T', 'zz-w1', 'L', 'D', -1); exception when others then s := sqlstate; end;
  perform gds_test.check('C24', s = '23514', 'отрицательный вес отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, weight_g) values (v_brand, v_cat, 'T', 'zz-w2', 'L', 'D', 10000); exception when others then s := sqlstate; end;
  perform gds_test.check('C25', s = '22003', 'вес 10000 не помещается в numeric(6,2): ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, nicotine_mg) values (v_brand, v_cat, 'T', 'zz-n1', 'L', 'D', -0.1); exception when others then s := sqlstate; end;
  perform gds_test.check('C26', s = '23514', 'отрицательная крепость отклонена: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, nicotine_mg) values (v_brand, v_cat, 'T', 'zz-n2', 'L', 'D', 100); exception when others then s := sqlstate; end;
  perform gds_test.check('C27', s = '22003', 'крепость 100 не помещается в numeric(4,2): ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, nicotine_mg) values (v_brand, v_cat, 'T', 'zz-n3', 'L', 'D', 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C28', s = 'ok', 'крепость 0 принята: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'zz-d1', 'L', ''); exception when others then s := sqlstate; end;
  perform gds_test.check('C29', s = '23514', 'пустое описание отклонено: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'zz-d2', 'L', null); exception when others then s := sqlstate; end;
  perform gds_test.check('C30', s = '23502', 'описание null отклонено: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'zz-d3', 'L', repeat('x', 4001)); exception when others then s := sqlstate; end;
  perform gds_test.check('C31', s = '23514', 'описание длиннее 4000 отклонено: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, '', 'zz-nm', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C32', s = '23514', 'пустое название вкуса отклонено: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'zz-l1', '', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C33', s = '23514', 'пустая линейка отклонена: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (gen_random_uuid(), v_cat, 'T', 'zz-b1', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C34', s = '23503', 'несуществующий бренд отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, gen_random_uuid(), 'T', 'zz-c1', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C35', s = '23503', 'несуществующая категория отклонена: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (null, v_cat, 'T', 'zz-b2', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C36', s = '23502', 'brand_id null отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, aroma_profile, tagline) values (v_brand, v_cat, 'T', 'zz-ok', 'L', 'D', null, null); exception when others then s := sqlstate; end;
  perform gds_test.check('C37', s = 'ok', 'tagline и aroma_profile могут быть null: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, tagline) values (v_brand, v_cat, 'T', 'zz-t1', 'L', 'D', ''); exception when others then s := sqlstate; end;
  perform gds_test.check('C38', s = '23514', 'пустая подпись (не null) отклонена: ' || s);
end $$;

-- C3: ссылки на картинки (https и безопасные символы) и product_images
do $$
declare
  s text;
  v_prod uuid;
begin
  select id into v_prod from public.products where slug = 'altair';

  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'http://x.test/a.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C40', s = '23514', 'ссылка http отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'javascript:alert(1)'); exception when others then s := sqlstate; end;
  perform gds_test.check('C41', s = '23514', 'ссылка javascript: отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'data:image/png;base64,AAAA'); exception when others then s := sqlstate; end;
  perform gds_test.check('C42', s = '23514', 'ссылка data: отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a b.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C43', s = '23514', 'ссылка с пробелом отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a"b.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C44', s = '23514', 'ссылка с двойной кавычкой отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/<script>'); exception when others then s := sqlstate; end;
  perform gds_test.check('C45', s = '23514', 'ссылка с < > отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'ftp://x.test/a.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C46', s = '23514', 'ссылка ftp отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'HTTPS://X.TEST/a.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C47', s = '23514', 'схема в верхнем регистре отклонена (нужно https в нижнем): ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/' || repeat('a', 2100)); exception when others then s := sqlstate; end;
  perform gds_test.check('C48', s = '23514', 'ссылка длиннее 2048 отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a' || E'\n'); exception when others then s := sqlstate; end;
  perform gds_test.check('C49', s = '23514', 'ссылка с переводом строки отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a''b.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C50', s = '23514', 'ссылка с одинарной кавычкой отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a\b.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C51', s = '23514', 'ссылка с обратной косой чертой отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://'); exception when others then s := sqlstate; end;
  perform gds_test.check('C52', s = '23514', 'ссылка без адреса отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://abc.supabase.co/storage/v1/object/public/product-images/altair/3f2b9c1e-0000-4000-8000-000000000001.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C53', s = 'ok', 'настоящая ссылка Storage принята: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://abc.supabase.co/storage/v1/object/public/product-images/altair/x.jpg?v=2&t=1#a'); exception when others then s := sqlstate; end;
  perform gds_test.check('C54', s = 'ok', 'ссылка с query и фрагментом принята: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, null); exception when others then s := sqlstate; end;
  perform gds_test.check('C55', s = '23502', 'image_url null отклонён: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (gen_random_uuid(), 'https://x.test/a.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C56', s = '23503', 'картинка несуществующего вкуса отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (null, 'https://x.test/a.jpg'); exception when others then s := sqlstate; end;
  perform gds_test.check('C57', s = '23502', 'product_id null отклонён: ' || s);
end $$;

-- C4: brands
do $$
declare s text;
begin
  s := 'ok'; begin insert into public.brands (name, full_name, country, logo_url) values ('B', 'B full', 'RU', 'javascript:alert(1)'); exception when others then s := sqlstate; end;
  perform gds_test.check('C60', s = '23514', 'logo_url javascript: отклонён: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country, logo_url) values ('B', 'B full', 'RU', 'http://x.test/l.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C61', s = '23514', 'logo_url http отклонён: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country, logo_url) values ('B', 'B full', 'RU', 'https://x.test/l.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C62', s = 'ok', 'logo_url https принят: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('B2', 'B full', 'RU'); exception when others then s := sqlstate; end;
  perform gds_test.check('C63', s = 'ok', 'logo_url и description могут быть null: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('', 'B full', 'RU'); exception when others then s := sqlstate; end;
  perform gds_test.check('C64', s = '23514', 'пустое имя бренда отклонено: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('B3', '', 'RU'); exception when others then s := sqlstate; end;
  perform gds_test.check('C65', s = '23514', 'пустое полное имя бренда отклонено: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('B4', 'B full', ''); exception when others then s := sqlstate; end;
  perform gds_test.check('C66', s = '23514', 'пустая страна отклонена: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country, description) values ('B5', 'B full', 'RU', repeat('x', 4001)); exception when others then s := sqlstate; end;
  perform gds_test.check('C67', s = '23514', 'описание бренда длиннее 4000 отклонено: ' || s);
end $$;

-- C5: stores
do $$
declare s text;
begin
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', 91, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C70', s = '23514', 'широта 91 отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', -91, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C71', s = '23514', 'широта -91 отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', 0, 181); exception when others then s := sqlstate; end;
  perform gds_test.check('C72', s = '23514', 'долгота 181 отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', 0, -181); exception when others then s := sqlstate; end;
  perform gds_test.check('C73', s = '23514', 'долгота -181 отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', 'NaN'::float8, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C74', s = '23514', 'широта NaN отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', 0, 'Infinity'::float8); exception when others then s := sqlstate; end;
  perform gds_test.check('C75', s = '23514', 'долгота Infinity отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', '-Infinity'::float8, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C76', s = '23514', 'широта -Infinity отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', 90, -180); exception when others then s := sqlstate; end;
  perform gds_test.check('C77', s = 'ok', 'граничные координаты 90 и -180 приняты: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', 'C', null, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C78', s = '23502', 'широта null отклонена: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, phone) values ('S', 'A', 'C', 0, 0, 'abc'); exception when others then s := sqlstate; end;
  perform gds_test.check('C79', s = '23514', 'телефон из букв отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, phone) values ('S', 'A', 'C', 0, 0, '1234'); exception when others then s := sqlstate; end;
  perform gds_test.check('C80', s = '23514', 'слишком короткий телефон отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, phone) values ('S', 'A', 'C', 0, 0, '8 800 300-49-99'); exception when others then s := sqlstate; end;
  perform gds_test.check('C81', s = 'ok', 'телефон из ТЗ принят: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'not-an-email'); exception when others then s := sqlstate; end;
  perform gds_test.check('C82', s = '23514', 'e-mail без @ отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a@b'); exception when others then s := sqlstate; end;
  perform gds_test.check('C83', s = '23514', 'e-mail без точки в домене отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a b@c.d'); exception when others then s := sqlstate; end;
  perform gds_test.check('C84', s = '23514', 'e-mail с пробелом отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'mtechno.tobacco@gmail.com'); exception when others then s := sqlstate; end;
  perform gds_test.check('C85', s = 'ok', 'e-mail из ТЗ принят: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('', 'A', 'C', 0, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C86', s = '23514', 'пустое название точки отклонено: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', '', 'C', 0, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C87', s = '23514', 'пустой адрес отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('S', 'A', '', 0, 0); exception when others then s := sqlstate; end;
  perform gds_test.check('C88', s = '23514', 'пустой город отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, working_hours) values ('S', 'A', 'C', 0, 0, repeat('x', 501)); exception when others then s := sqlstate; end;
  perform gds_test.check('C89', s = '23514', 'часы работы длиннее 500 отклонены: ' || s);
end $$;

-- C6: user_roles
do $$
declare s text;
begin
  insert into auth.users (id, email) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'role-test@example.test');
  s := 'ok'; begin insert into public.user_roles (id, role) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'superuser'); exception when others then s := sqlstate; end;
  perform gds_test.check('C90', s = '23514', 'роль, кроме admin, отклонена: ' || s);
  s := 'ok'; begin insert into public.user_roles (id, role) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', null); exception when others then s := sqlstate; end;
  perform gds_test.check('C91', s = '23502', 'роль null отклонена: ' || s);
  s := 'ok'; begin insert into public.user_roles (id, role) values (gen_random_uuid(), 'admin'); exception when others then s := sqlstate; end;
  perform gds_test.check('C92', s = '23503', 'роль для несуществующего пользователя отклонена: ' || s);
  s := 'ok'; begin insert into public.user_roles (id) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'); exception when others then s := sqlstate; end;
  perform gds_test.check('C93', s = 'ok', 'роль по умолчанию принята (admin): ' || s);
  s := 'ok'; begin insert into public.user_roles (id, role) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'admin'); exception when others then s := sqlstate; end;
  perform gds_test.check('C94', s = '23505', 'вторая роль того же пользователя отклонена: ' || s);

  delete from auth.users where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  perform gds_test.check('C95', not exists (select 1 from public.user_roles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    'удаление пользователя в auth удаляет его роль (cascade)');
end $$;

-- C8: ужесточённые проверки: NaN, пустые строки, ссылки и e-mail ---------------
do $$
declare
  s text;
  v_brand uuid; v_cat uuid; v_prod uuid;
begin
  select id into v_brand from public.brands where name = 'GDS Джедес';
  select id into v_cat from public.categories where slug = 'hookah-tobacco';
  select id into v_prod from public.products where slug = 'altair';

  -- numeric: NaN проходит обычное «> 0», поэтому границы заданы через between
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, weight_g) values (v_brand, v_cat, 'T', 'zz-nan1', 'L', 'D', 'NaN'); exception when others then s := sqlstate; end;
  perform gds_test.check('C100', s = '23514', 'вес NaN отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, nicotine_mg) values (v_brand, v_cat, 'T', 'zz-nan2', 'L', 'D', 'NaN'); exception when others then s := sqlstate; end;
  perform gds_test.check('C101', s = '23514', 'крепость NaN отклонена: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, weight_g) values (v_brand, v_cat, 'T', 'zz-w3', 'L', 'D', 0.01); exception when others then s := sqlstate; end;
  perform gds_test.check('C102', s = 'ok', 'вес 0,01 принят (нижняя граница): ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, weight_g) values (v_brand, v_cat, 'T', 'zz-w4', 'L', 'D', 9999.99); exception when others then s := sqlstate; end;
  perform gds_test.check('C103', s = 'ok', 'вес 9999,99 принят (верхняя граница): ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, weight_g) values (v_brand, v_cat, 'T', 'zz-w5', 'L', 'D', 0.004); exception when others then s := sqlstate; end;
  perform gds_test.check('C104', s = '23514', 'вес 0,004 (округляется до 0,00) отклонён: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, nicotine_mg) values (v_brand, v_cat, 'T', 'zz-n4', 'L', 'D', 99.99); exception when others then s := sqlstate; end;
  perform gds_test.check('C105', s = 'ok', 'крепость 99,99 принята (верхняя граница): ' || s);

  -- строки из одних пробельных символов (перевод строки, табуляция)
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, E'\n', 'zz-b1x', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C106', s = '23514', 'название вкуса из перевода строки отклонено: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values (E'\t', 'zz-tab-cat'); exception when others then s := sqlstate; end;
  perform gds_test.check('C107', s = '23514', 'название категории из табуляции отклонено: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country) values (E'\n', 'F', 'C'); exception when others then s := sqlstate; end;
  perform gds_test.check('C108', s = '23514', 'название бренда из перевода строки отклонено: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values (E'\t', 'A', 'C', 1, 1); exception when others then s := sqlstate; end;
  perform gds_test.check('C109', s = '23514', 'название точки из табуляции отклонено: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'T', 'zz-d4', 'L', E'\n\n'); exception when others then s := sqlstate; end;
  perform gds_test.check('C110', s = '23514', 'описание из переводов строки отклонено: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description, tagline) values (v_brand, v_cat, 'T', 'zz-t2', 'L', 'D', '   '); exception when others then s := sqlstate; end;
  perform gds_test.check('C111', s = '23514', 'подпись из пробелов отклонена: ' || s);
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'Название с переводом' || E'\n' || 'строки', 'zz-nl', 'L', 'D'); exception when others then s := sqlstate; end;
  perform gds_test.check('C112', s = 'ok', 'перевод строки внутри текста допускается (не только из пробелов): ' || s);

  -- ссылки: узкий набор символов
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://abc.supabase.co@evil.example/x.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C120', s = '23514', 'ссылка с @ (приём «https://хороший@плохой/») отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a);background:url(https://e.test/'); exception when others then s := sqlstate; end;
  perform gds_test.check('C121', s = '23514', 'ссылка со скобками и точкой с запятой (выход из CSS url) отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a,b.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C122', s = '23514', 'ссылка с запятой отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a$b.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C123', s = '23514', 'ссылка с $ отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a*b.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C124', s = '23514', 'ссылка с * отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a[b].png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C125', s = '23514', 'ссылка с квадратными скобками отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a!b.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C126', s = '23514', 'ссылка с ! отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/a`b.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C127', s = '23514', 'ссылка с обратным апострофом отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/а.png'); exception when others then s := sqlstate; end;
  perform gds_test.check('C128', s = '23514', 'ссылка с кириллицей (без %-кодирования) отклонена: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://abc.supabase.co/storage/v1/object/sign/product-images/altair/x.jpg?token=eyJhbGciOi.JIUzI1NiIs-_x&t=2026-10-08T10%3A00%3A00.000Z'); exception when others then s := sqlstate; end;
  perform gds_test.check('C129', s = 'ok', 'ссылка с подписанным токеном и %-кодированием принята: ' || s);
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/~user/a_b-c.d+e=f&g#h'); exception when others then s := sqlstate; end;
  perform gds_test.check('C130', s = 'ok', 'ссылка с ~ _ - . + = & # принята: ' || s);
  s := 'ok'; begin insert into public.brands (name, full_name, country, logo_url) values ('LB', 'LB', 'RU', 'https://x.test/a"onerror="alert(1)'); exception when others then s := sqlstate; end;
  perform gds_test.check('C131', s = '23514', 'logo_url с кавычками отклонён: ' || s);

  -- e-mail: узкий набор символов
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, '"><svg/onload=alert(1)>@a.bc'); exception when others then s := sqlstate; end;
  perform gds_test.check('C140', s = '23514', 'e-mail с разметкой отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a&b@c.de'); exception when others then s := sqlstate; end;
  perform gds_test.check('C141', s = '23514', 'e-mail с & отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a''b@c.de'); exception when others then s := sqlstate; end;
  perform gds_test.check('C142', s = '23514', 'e-mail с апострофом отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a;b@c.de'); exception when others then s := sqlstate; end;
  perform gds_test.check('C143', s = '23514', 'e-mail с ; отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a@b..de'); exception when others then s := sqlstate; end;
  perform gds_test.check('C144', s = '23514', 'e-mail с пустой частью домена (..) отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a@b.c'); exception when others then s := sqlstate; end;
  perform gds_test.check('C145', s = '23514', 'e-mail с зоной из одной буквы отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'первый@пример.рф'); exception when others then s := sqlstate; end;
  perform gds_test.check('C146', s = '23514', 'e-mail кириллицей отклонён (нужен латинский адрес): ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'first.last+tag@sub-domain.example.co'); exception when others then s := sqlstate; end;
  perform gds_test.check('C147', s = 'ok', 'обычный e-mail с точкой, плюсом и поддоменом принят: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a@-.bc'); exception when others then s := sqlstate; end;
  perform gds_test.check('C148', s = '23514', 'e-mail с частью домена из одного дефиса отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('S', 'A', 'C', 0, 0, 'a@b-.cd'); exception when others then s := sqlstate; end;
  perform gds_test.check('C149', s = '23514', 'e-mail с частью домена, оканчивающейся дефисом, отклонён: ' || s);

  -- телефон: нужна хотя бы одна цифра
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, phone) values ('S', 'A', 'C', 0, 0, '     '); exception when others then s := sqlstate; end;
  perform gds_test.check('C150', s = '23514', 'телефон из одних пробелов отклонён: ' || s);
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, phone) values ('S', 'A', 'C', 0, 0, '((((('); exception when others then s := sqlstate; end;
  perform gds_test.check('C151', s = '23514', 'телефон из одних скобок отклонён: ' || s);

  -- невидимые знаки: неразрывный пробел и знак нулевой ширины (коды через chr, без невидимых символов в файле)
  s := 'ok'; begin insert into public.categories (name, slug) values (chr(8203), 'zz-zwsp'); exception when others then s := sqlstate; end;
  perform gds_test.check('C113', s = '23514', 'название из одного знака нулевой ширины отклонено: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values (chr(160) || chr(160), 'zz-nbsp'); exception when others then s := sqlstate; end;
  perform gds_test.check('C114', s = '23514', 'название из неразрывных пробелов отклонено: ' || s);
  s := 'ok'; begin insert into public.categories (name, slug) values ('Название' || chr(8203), 'zz-zwsp-ok'); exception when others then s := sqlstate; end;
  perform gds_test.check('C115', s = 'ok', 'название с невидимым знаком внутри обычного текста допускается: ' || s);
end $$;

-- C7: удаление: restrict у бренда и категории, cascade у картинок -------------
do $$
declare
  s text; v_prod uuid; v_n int;
begin
  s := 'ok'; begin delete from public.brands where name = 'GDS Джедес'; exception when others then s := sqlstate; end;
  perform gds_test.check('DL01', s = '23503', 'удалить бренд, у которого есть вкусы, нельзя: ' || s);
  s := 'ok'; begin delete from public.categories where slug = 'hookah-tobacco'; exception when others then s := sqlstate; end;
  perform gds_test.check('DL02', s = '23503', 'удалить категорию, у которой есть вкусы, нельзя: ' || s);

  select id into v_prod from public.products where slug = 'altair';
  insert into public.product_images (product_id, image_url) values (v_prod, 'https://x.test/d1.jpg'), (v_prod, 'https://x.test/d2.jpg');
  select count(*) into v_n from public.product_images where product_id = v_prod;
  perform gds_test.check('DL03a', v_n >= 2,'у вкуса есть картинки перед удалением: ' || v_n);
  delete from public.products where id = v_prod;
  select count(*) into v_n from public.product_images where product_id = v_prod;
  perform gds_test.check('DL03b', v_n = 0,'удаление вкуса удаляет его картинки (cascade): осталось ' || v_n);
end $$;

rollback;

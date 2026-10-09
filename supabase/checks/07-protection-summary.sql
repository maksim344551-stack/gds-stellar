-- check:07-protection-summary
do $$
declare
  v_tables text[] := array['brands', 'categories', 'products', 'product_images', 'stores', 'user_roles'];
  v_expected text[] := array[
    'brands.brands_public_read', 'brands.brands_admin_read_all', 'brands.brands_admin_insert',
    'brands.brands_admin_update', 'brands.brands_admin_delete',
    'categories.categories_public_read', 'categories.categories_admin_insert',
    'categories.categories_admin_update', 'categories.categories_admin_delete',
    'products.products_public_read', 'products.products_admin_read_all', 'products.products_admin_insert',
    'products.products_admin_update', 'products.products_admin_delete',
    'product_images.product_images_public_read', 'product_images.product_images_admin_read_all',
    'product_images.product_images_admin_insert', 'product_images.product_images_admin_update',
    'product_images.product_images_admin_delete',
    'stores.stores_public_read', 'stores.stores_admin_read_all', 'stores.stores_admin_insert',
    'stores.stores_admin_update', 'stores.stores_admin_delete',
    'user_roles.user_roles_read_own'
  ];
  v_table text;
  v_priv text;
  v_n int;
  v_cfg text[];
  v_list text;
begin
  foreach v_table in array v_tables loop
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = v_table) then
      raise exception 'ПРОВАЛ: RLS выключен на public.%', v_table;
    end if;
    foreach v_priv in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege('anon', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'ПРОВАЛ: у anon есть право % на public.% (или на её колонку)', v_priv, v_table;
      end if;
    end loop;
    foreach v_priv in array array['DELETE', 'TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('anon', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'ПРОВАЛ: у anon есть право % на public.%', v_priv, v_table;
      end if;
    end loop;
    if has_any_column_privilege('authenticated', format('public.%I', v_table)::regclass, 'REFERENCES') then
      raise exception 'ПРОВАЛ: у authenticated есть право REFERENCES на public.% (или на её колонку)', v_table;
    end if;
    foreach v_priv in array array['TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('authenticated', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'ПРОВАЛ: у authenticated есть право % на public.%', v_priv, v_table;
      end if;
    end loop;
  end loop;

  if has_any_column_privilege('anon', 'public.user_roles'::regclass, 'SELECT') then
    raise exception 'ПРОВАЛ: anon может читать public.user_roles (или её колонку)';
  end if;
  foreach v_priv in array array['INSERT', 'UPDATE'] loop
    if has_any_column_privilege('authenticated', 'public.user_roles'::regclass, v_priv) then
      raise exception 'ПРОВАЛ: у authenticated есть право % на public.user_roles (или на её колонку)', v_priv;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.user_roles'::regclass, 'DELETE') then
    raise exception 'ПРОВАЛ: у authenticated есть право DELETE на public.user_roles';
  end if;

  if has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') then
    raise exception 'ПРОВАЛ: anon может вызывать public.is_admin()';
  end if;
  select count(*) into v_n
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = 'public.is_admin()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: PUBLIC может вызывать public.is_admin()';
  end if;
  select proconfig into v_cfg from pg_proc where oid = 'public.is_admin()'::regprocedure;
  if not (select prosecdef from pg_proc where oid = 'public.is_admin()'::regprocedure)
     or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception 'ПРОВАЛ: public.is_admin() должна быть SECURITY DEFINER с пустым search_path (сейчас: %)', coalesce(array_to_string(v_cfg, ','), 'нет настроек');
  end if;

  -- Политики на таблицах каталога: ровно наши, без чужих и ничего не пропало.
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into v_list
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = any (v_tables)
    and not ((p.tablename || '.' || p.policyname) = any (v_expected));
  if v_list is not null then
    raise exception 'ПРОВАЛ: на таблицах каталога есть посторонние политики: %', v_list;
  end if;
  select string_agg(e, ', ' order by e) into v_list
  from unnest(v_expected) as e
  where not exists (select 1 from pg_policies p where p.schemaname = 'public' and (p.tablename || '.' || p.policyname) = e);
  if v_list is not null then
    raise exception 'ПРОВАЛ: пропали политики: %', v_list;
  end if;

  select count(*) into v_n from pg_views where schemaname = 'public';
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: в схеме public есть % представлений (view); они по умолчанию обходят RLS', v_n;
  end if;

  select count(*) into v_n from pg_tables where schemaname = 'public' and not rowsecurity;
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: в схеме public есть % таблиц без RLS', v_n;
  end if;
end
$$;

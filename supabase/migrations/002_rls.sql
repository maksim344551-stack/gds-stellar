-- =============================================================================
-- 002_rls.sql
-- GDS «Джедес»: права доступа и Row Level Security (RLS).
-- =============================================================================
-- Что делает файл:
--   1. создаёт функцию public.is_admin(): «текущий пользователь админ?»;
--   2. выдаёт ролям anon и authenticated только нужные права на таблицы
--      (всё остальное отозвано в 001_init.sql и здесь подтверждается заново);
--   3. создаёт политики RLS (какие строки видит и меняет каждая роль);
--   4. в конце сам проверяет итог и ОТКАТЫВАЕТ всё, если защита собрана не так.
--
-- Два слоя защиты, оба нужны:
--   права (GRANT)  отвечают на вопрос «можно ли роли вообще трогать таблицу»;
--   политики (RLS) отвечают на вопрос «какие именно строки».
--   Без права запрос отклоняется до проверки политик.
--
-- Роли Supabase:
--   anon           запрос с публичным ключом, пользователь не вошёл;
--   authenticated  запрос от вошедшего пользователя (в том числе от обычного,
--                  не админа: он видит то же, что anon);
--   service_role   серверный ключ (secret), обходит RLS; на сайте его быть не
--                  должно, права ему выдаются для будущих серверных скриптов.
--
-- Как выполнять: SQL Editor -> вставить файл целиком -> Run. Ожидаемый ответ:
-- «Success. No rows returned». Повторный запуск безопасен: политики пересоздаются
-- (drop policy if exists относится только к политикам, которые создаёт этот файл).
-- Выполнять после 001_init.sql.
-- =============================================================================

begin;

-- 1. is_admin() -------------------------------------------------------------
-- SECURITY DEFINER: функция выполняется с правами владельца и поэтому может
-- прочитать user_roles, хотя у обычного пользователя доступа к чужим строкам
-- нет. Безопасность такой функции держится на трёх вещах:
--   set search_path = ''  все имена внутри записаны полностью (public.user_roles,
--                         auth.uid), подменить их своими объектами нельзя;
--   право вызова          только у authenticated (ниже), у anon и PUBLIC отозвано;
--   что возвращает        только true/false про того, кто вызывает.
-- Если auth.uid() пуст (запрос без входа), результат всегда false.
-- (select auth.uid()) вычисляется один раз на запрос, а не на каждую строку.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.user_roles ur
       where ur.id = (select auth.uid())
         and ur.role = 'admin'
     );
$$;

comment on function public.is_admin() is
  'true, если вошедший пользователь есть в user_roles с ролью admin; иначе false (в том числе без входа).';

-- По умолчанию Supabase может выдать право вызова всем (PUBLIC, anon,
-- authenticated). Оставляем только authenticated: политики для роли anon эту
-- функцию не вызывают.
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- 2. RLS включён везде (повтор из 001: безопасно) ---------------------------
alter table public.brands         enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.product_images enable row level security;
alter table public.stores         enable row level security;
alter table public.user_roles     enable row level security;

-- 3. Права на таблицы -------------------------------------------------------
-- Сначала отзываем всё (в том числе то, что платформа выдаёт новым таблицам по
-- умолчанию: в старых проектах Supabase это полный набор прав для anon и
-- authenticated, включая TRUNCATE, который RLS не ограничивает), потом выдаём
-- минимум. Так итог для anon и authenticated одинаков при обоих режимах
-- платформы (права выдаются автоматически или не выдаются). У service_role в
-- старых проектах остаются лишние служебные права; на каталог и на сайт они не
-- влияют, ключ этой роли на сайте быть не должен.
revoke all on table
  public.brands, public.categories, public.products,
  public.product_images, public.stores, public.user_roles
from public, anon, authenticated;

-- anon (публичный ключ): только чтение пяти таблиц каталога. user_roles не видна.
grant select on table
  public.brands, public.categories, public.products,
  public.product_images, public.stores
to anon;

-- authenticated: чтение и запись каталога. Что из этого реально разрешено,
-- решают политики ниже: писать может только админ. user_roles: только чтение
-- своей строки.
grant select, insert, update, delete on table
  public.brands, public.categories, public.products,
  public.product_images, public.stores
to authenticated;
grant select on table public.user_roles to authenticated;

-- service_role (серверные скрипты владельца; обходит RLS).
grant select, insert, update, delete on table
  public.brands, public.categories, public.products,
  public.product_images, public.stores, public.user_roles
to service_role;

-- 4. Политики: brands -------------------------------------------------------
-- Публика читает только активные бренды.
drop policy if exists brands_public_read on public.brands;
create policy brands_public_read on public.brands
  for select to anon, authenticated
  using (is_active);

-- Админ видит все бренды, включая скрытые (для админки).
drop policy if exists brands_admin_read_all on public.brands;
create policy brands_admin_read_all on public.brands
  for select to authenticated
  using ((select public.is_admin()));

-- Добавлять бренды может только админ.
drop policy if exists brands_admin_insert on public.brands;
create policy brands_admin_insert on public.brands
  for insert to authenticated
  with check ((select public.is_admin()));

-- Менять бренды может только админ (и до, и после изменения строка проверяется).
drop policy if exists brands_admin_update on public.brands;
create policy brands_admin_update on public.brands
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Удалять бренды может только админ (при наличии вкусов удаление запретит
-- внешний ключ restrict из 001_init.sql).
drop policy if exists brands_admin_delete on public.brands;
create policy brands_admin_delete on public.brands
  for delete to authenticated
  using ((select public.is_admin()));

-- 5. Политики: categories ---------------------------------------------------
-- В таблице нет колонки is_active (так в ТЗ), поэтому «только активные» здесь
-- неприменимо: категории читают все. Отдельной политики «админ видит все
-- строки» нет: она ничего бы не добавила, все строки и так видны.
drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (true);

-- Добавлять категории может только админ.
drop policy if exists categories_admin_insert on public.categories;
create policy categories_admin_insert on public.categories
  for insert to authenticated
  with check ((select public.is_admin()));

-- Менять категории может только админ.
drop policy if exists categories_admin_update on public.categories;
create policy categories_admin_update on public.categories
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Удалять категории может только админ (если в категории есть вкусы, внешний
-- ключ restrict не даст).
drop policy if exists categories_admin_delete on public.categories;
create policy categories_admin_delete on public.categories
  for delete to authenticated
  using ((select public.is_admin()));

-- 6. Политики: products -----------------------------------------------------
-- Публика читает вкус, только если активен он сам И его бренд. Так скрытие
-- бренда убирает с сайта и его вкусы (расширение ТЗ в сторону строгости).
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1
      from public.brands b
      where b.id = products.brand_id
        and b.is_active
    )
  );

-- Админ видит все вкусы, включая скрытые (is_active = false).
drop policy if exists products_admin_read_all on public.products;
create policy products_admin_read_all on public.products
  for select to authenticated
  using ((select public.is_admin()));

-- Добавлять вкусы может только админ.
drop policy if exists products_admin_insert on public.products;
create policy products_admin_insert on public.products
  for insert to authenticated
  with check ((select public.is_admin()));

-- Менять вкусы может только админ.
drop policy if exists products_admin_update on public.products;
create policy products_admin_update on public.products
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Удалять вкусы может только админ (картинки вкуса в таблице удалятся каскадом).
drop policy if exists products_admin_delete on public.products;
create policy products_admin_delete on public.products
  for delete to authenticated
  using ((select public.is_admin()));

-- 7. Политики: product_images -----------------------------------------------
-- В таблице нет is_active (так в ТЗ), поэтому видимость берётся у родителя:
-- публика видит картинку, только если виден её вкус (активный вкус активного
-- бренда). Иначе ссылки на картинки скрытых вкусов утекали бы через API.
drop policy if exists product_images_public_read on public.product_images;
create policy product_images_public_read on public.product_images
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      join public.brands b on b.id = p.brand_id
      where p.id = product_images.product_id
        and p.is_active
        and b.is_active
    )
  );

-- Админ видит все картинки.
drop policy if exists product_images_admin_read_all on public.product_images;
create policy product_images_admin_read_all on public.product_images
  for select to authenticated
  using ((select public.is_admin()));

-- Добавлять картинки может только админ.
drop policy if exists product_images_admin_insert on public.product_images;
create policy product_images_admin_insert on public.product_images
  for insert to authenticated
  with check ((select public.is_admin()));

-- Менять картинки может только админ.
drop policy if exists product_images_admin_update on public.product_images;
create policy product_images_admin_update on public.product_images
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Удалять картинки может только админ.
drop policy if exists product_images_admin_delete on public.product_images;
create policy product_images_admin_delete on public.product_images
  for delete to authenticated
  using ((select public.is_admin()));

-- 8. Политики: stores -------------------------------------------------------
-- Публика читает только активные точки.
drop policy if exists stores_public_read on public.stores;
create policy stores_public_read on public.stores
  for select to anon, authenticated
  using (is_active);

-- Админ видит все точки, включая скрытые.
drop policy if exists stores_admin_read_all on public.stores;
create policy stores_admin_read_all on public.stores
  for select to authenticated
  using ((select public.is_admin()));

-- Добавлять точки может только админ.
drop policy if exists stores_admin_insert on public.stores;
create policy stores_admin_insert on public.stores
  for insert to authenticated
  with check ((select public.is_admin()));

-- Менять точки может только админ.
drop policy if exists stores_admin_update on public.stores;
create policy stores_admin_update on public.stores
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Удалять точки может только админ.
drop policy if exists stores_admin_delete on public.stores;
create policy stores_admin_delete on public.stores
  for delete to authenticated
  using ((select public.is_admin()));

-- 9. Политики: user_roles ---------------------------------------------------
-- anon: ни прав, ни политик (таблицы для него нет).
-- authenticated: видит только свою строку. Политик на запись нет вообще, так
-- что назначить себе или другому роль через REST нельзя ни при каких условиях:
-- роли выдаёт только владелец в SQL Editor.
drop policy if exists user_roles_read_own on public.user_roles;
create policy user_roles_read_own on public.user_roles
  for select to authenticated
  using (id = (select auth.uid()));

-- 10. Самопроверка итога ----------------------------------------------------
-- Если что-то собрано не так (например, платформа выдала лишние права или на
-- таблицах каталога есть чужая политика, созданная вручную по шаблону из
-- панели), весь файл откатывается и ничего не применяется. Проверки только
-- читают каталог системных таблиц.
-- Когда новые миграции добавят свои политики, внесите их имена в список
-- v_expected_policies ниже, иначе повторный запуск этого файла остановится.
do $$
declare
  v_tables text[] := array['brands', 'categories', 'products', 'product_images', 'stores', 'user_roles'];
  v_expected_policies text[] := array[
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
  v_priv  text;
  v_unexpected text;
  v_missing text;
begin
  -- RLS включён на всех шести таблицах.
  foreach v_table in array v_tables loop
    if not (select c.relrowsecurity
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = v_table) then
      raise exception 'GDS 002: RLS не включён на public.%; ничего не применено', v_table;
    end if;
  end loop;

  -- anon: ни права записи, ни служебных прав ни на одной таблице. INSERT, UPDATE и
  -- REFERENCES проверяются вместе с правами на отдельные колонки.
  foreach v_table in array v_tables loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege('anon', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'GDS 002: у роли anon есть право % на public.% (или на её колонку); ничего не применено', v_priv, v_table;
      end if;
    end loop;
    foreach v_priv in array array['DELETE', 'TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('anon', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'GDS 002: у роли anon есть право % на public.%; ничего не применено', v_priv, v_table;
      end if;
    end loop;
  end loop;
  if has_any_column_privilege('anon', 'public.user_roles'::regclass, 'SELECT') then
    raise exception 'GDS 002: у роли anon есть доступ к public.user_roles (или к её колонке); ничего не применено';
  end if;

  -- authenticated: нет служебных прав; в user_roles нет записи.
  foreach v_table in array v_tables loop
    if has_any_column_privilege('authenticated', format('public.%I', v_table)::regclass, 'REFERENCES') then
      raise exception 'GDS 002: у роли authenticated есть право REFERENCES на public.% (или на её колонку); ничего не применено', v_table;
    end if;
    foreach v_priv in array array['TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('authenticated', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'GDS 002: у роли authenticated есть право % на public.%; ничего не применено', v_priv, v_table;
      end if;
    end loop;
  end loop;
  foreach v_priv in array array['INSERT', 'UPDATE'] loop
    if has_any_column_privilege('authenticated', 'public.user_roles'::regclass, v_priv) then
      raise exception 'GDS 002: у роли authenticated есть право % на public.user_roles (или на её колонку); ничего не применено', v_priv;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.user_roles'::regclass, 'DELETE') then
    raise exception 'GDS 002: у роли authenticated есть право DELETE на public.user_roles; ничего не применено';
  end if;

  -- is_admin(): anon вызывать не может, authenticated может.
  if has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') then
    raise exception 'GDS 002: роль anon может вызывать public.is_admin(); ничего не применено';
  end if;
  if not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') then
    raise exception 'GDS 002: роль authenticated не может вызывать public.is_admin(); ничего не применено';
  end if;

  -- Политики на этих таблицах: ровно наши, без чужих. Чужая политика (например,
  -- «Enable read access for all users» из шаблонов панели) могла бы открыть
  -- скрытые строки или дать запись любому вошедшему.
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into v_unexpected
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename = any (v_tables)
    and not ((p.tablename || '.' || p.policyname) = any (v_expected_policies));
  if v_unexpected is not null then
    raise exception 'GDS 002: на таблицах каталога есть посторонние политики (%). Удалите их (Authentication -> Policies в панели или drop policy) и повторите; ничего не применено', v_unexpected;
  end if;

  select string_agg(e, ', ' order by e)
    into v_missing
  from unnest(v_expected_policies) as e
  where not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and (p.tablename || '.' || p.policyname) = e
  );
  if v_missing is not null then
    raise exception 'GDS 002: не созданы политики (%); ничего не применено', v_missing;
  end if;
end;
$$;

commit;

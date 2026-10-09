-- =============================================================================
-- 20_access_matrix.test.sql: матрица доступа «роль x таблица x действие».
-- ТЕСТОВЫЙ ФАЙЛ, не для боевой базы. Запускается из supabase/tests/run.mjs.
-- =============================================================================
-- Как имитируется вход: set local role <роль> и настройка request.jwt.claims с
-- полем sub (из него auth.uid() берёт идентификатор пользователя).
--   anon           публичный ключ, без входа
--   пользователь C вошёл, но НЕ админ (нет строки в user_roles)
--   админ A        вошёл, есть строка в user_roles (второй админ B нужен, чтобы
--                  проверить, что A не видит строку B)
-- Фикстуры (скрытый бренд, скрытый вкус, скрытая точка) создаёт суперпользователь
-- внутри транзакции; в конце всё откатывается.
-- Когда запись запрещена правами, ожидается код 42501 (permission denied).
-- Когда запрещена политикой RLS: для INSERT ожидается 42501 (new row violates
-- row-level security policy), для UPDATE и DELETE ошибки нет, затронуто 0 строк.
-- =============================================================================

begin;

-- Фикстуры ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin-a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin-b@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'user-c@example.test');

insert into public.user_roles (id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin');

-- Скрытый бренд.
insert into public.brands (id, name, full_name, country, is_active)
values ('11111111-1111-4111-8111-111111111111', 'ZZ Hidden Brand', 'ZZ Hidden Brand Full', 'Test', false);

-- Скрытый вкус у активного бренда.
insert into public.products (id, brand_id, category_id, name, slug, line, description, is_active)
select '22222222-2222-4222-8222-222222222222', b.id, c.id,
       'ZZ Inactive', 'zz-inactive', 'Test', 'Test description', false
from public.brands b, public.categories c
where b.name = 'GDS Джедес' and c.slug = 'hookah-tobacco';

-- Активный вкус у скрытого бренда (должен быть скрыт вместе с брендом).
insert into public.products (id, brand_id, category_id, name, slug, line, description, is_active)
select '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', c.id,
       'ZZ Under Hidden Brand', 'zz-under-hidden-brand', 'Test', 'Test description', true
from public.categories c
where c.slug = 'hookah-tobacco';

-- Картинки: у видимого вкуса, у скрытого вкуса, у вкуса скрытого бренда.
insert into public.product_images (product_id, image_url)
select id, 'https://example.test/altair.jpg' from public.products where slug = 'altair';
insert into public.product_images (product_id, image_url) values
  ('22222222-2222-4222-8222-222222222222', 'https://example.test/inactive.jpg'),
  ('33333333-3333-4333-8333-333333333333', 'https://example.test/hidden-brand.jpg');

-- Скрытая точка продаж.
insert into public.stores (id, name, address, city, latitude, longitude, is_active)
values ('44444444-4444-4444-8444-444444444444', 'ZZ Hidden Store', 'Addr', 'City', 1, 1, false);

-- Базовая сверка фикстур (суперпользователь видит всё).
do $$
declare n_products int; n_brands int; n_images int; n_stores int;
begin
  select count(*) into n_products from public.products;
  select count(*) into n_brands from public.brands;
  select count(*) into n_images from public.product_images;
  select count(*) into n_stores from public.stores;
  perform gds_test.check('X00', n_products = 12 and n_brands = 2 and n_images = 3 and n_stores = 2,
    'фикстуры на месте: вкусов ' || n_products || ', брендов ' || n_brands || ', картинок ' || n_images || ', точек ' || n_stores);
end $$;

-- A: anon читает ------------------------------------------------------------------
do $$
declare
  n_products int; n_inactive int; n_brands int; n_cat int; n_img int; n_stores int;
  n_hidden int; n_hidden_brand int; s text;
begin
  set local role anon;
  select count(*) into n_products from public.products;
  select count(*) into n_inactive from public.products where is_active = false;
  select count(*) into n_brands from public.brands;
  select count(*) into n_cat from public.categories;
  select count(*) into n_img from public.product_images;
  select count(*) into n_stores from public.stores;
  select count(*) into n_hidden from public.products where slug = 'zz-inactive';
  select count(*) into n_hidden_brand from public.products where slug = 'zz-under-hidden-brand';

  s := 'ok'; begin perform count(*) from public.user_roles; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('A01', n_products = 10, 'anon видит 10 активных вкусов (получено ' || n_products || ')');
  perform gds_test.check('A02', n_inactive = 0, 'anon не видит неактивных вкусов: ' || n_inactive);
  perform gds_test.check('A03', n_brands = 1, 'anon видит 1 активный бренд (скрытый нет): ' || n_brands);
  perform gds_test.check('A04', n_cat = 1, 'anon видит категорию: ' || n_cat);
  perform gds_test.check('A05', n_img = 1, 'anon видит только картинку видимого вкуса: ' || n_img);
  perform gds_test.check('A06', n_stores = 1, 'anon видит 1 активную точку (скрытую нет): ' || n_stores);
  perform gds_test.check('A07', n_hidden = 0, 'скрытый вкус не виден anon');
  perform gds_test.check('A08', n_hidden_brand = 0, 'активный вкус скрытого бренда не виден anon');
  perform gds_test.check('A09', s = '42501', 'anon не может читать user_roles (42501): ' || s);

  set local role anon;
  s := 'ok'; begin perform public.is_admin(); exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('A10', s = '42501', 'anon не может вызывать is_admin (42501): ' || s);
end $$;

-- B: anon пишет: везде отказ по правам (42501) --------------------------------------
do $$
declare s text;
begin
  set local role anon;

  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('HACK', 'HACK', 'HACK'); exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('B01', s = '42501', 'anon INSERT brands: ' || s);
  set local role anon;
  s := 'ok'; begin update public.brands set name = 'HACK' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B02', s = '42501', 'anon UPDATE brands: ' || s);
  set local role anon;
  s := 'ok'; begin delete from public.brands where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B03', s = '42501', 'anon DELETE brands: ' || s);

  set local role anon;
  s := 'ok'; begin insert into public.categories (name, slug) values ('HACK', 'hack'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B04', s = '42501', 'anon INSERT categories: ' || s);
  set local role anon;
  s := 'ok'; begin update public.categories set name = 'HACK' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B05', s = '42501', 'anon UPDATE categories: ' || s);
  set local role anon;
  s := 'ok'; begin delete from public.categories where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B06', s = '42501', 'anon DELETE categories: ' || s);

  set local role anon;
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description)
    select b.id, c.id, 'HACK', 'hack', 'L', 'D' from public.brands b, public.categories c limit 1;
  exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B07', s = '42501', 'anon INSERT products: ' || s);
  set local role anon;
  s := 'ok'; begin update public.products set description = 'HACK' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B08', s = '42501', 'anon UPDATE products: ' || s);
  set local role anon;
  s := 'ok'; begin delete from public.products where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B09', s = '42501', 'anon DELETE products: ' || s);

  set local role anon;
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values ('22222222-2222-4222-8222-222222222222', 'https://example.test/h.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B10', s = '42501', 'anon INSERT product_images: ' || s);
  set local role anon;
  s := 'ok'; begin update public.product_images set image_url = 'https://example.test/h.jpg' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B11', s = '42501', 'anon UPDATE product_images: ' || s);
  set local role anon;
  s := 'ok'; begin delete from public.product_images where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B12', s = '42501', 'anon DELETE product_images: ' || s);

  set local role anon;
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('HACK', 'A', 'C', 1, 1); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B13', s = '42501', 'anon INSERT stores: ' || s);
  set local role anon;
  s := 'ok'; begin update public.stores set name = 'HACK' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B14', s = '42501', 'anon UPDATE stores: ' || s);
  set local role anon;
  s := 'ok'; begin delete from public.stores where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B15', s = '42501', 'anon DELETE stores: ' || s);

  set local role anon;
  s := 'ok'; begin insert into public.user_roles (id, role) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B16', s = '42501', 'anon INSERT user_roles: ' || s);
  set local role anon;
  s := 'ok'; begin update public.user_roles set role = 'admin' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B17', s = '42501', 'anon UPDATE user_roles: ' || s);
  set local role anon;
  s := 'ok'; begin delete from public.user_roles where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B18', s = '42501', 'anon DELETE user_roles: ' || s);

  set local role anon;
  s := 'ok'; begin truncate public.products; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B19', s = '42501', 'anon TRUNCATE products: ' || s);
  set local role anon;
  s := 'ok'; begin truncate public.user_roles; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B20', s = '42501', 'anon TRUNCATE user_roles: ' || s);

  -- Подделанный sub админа не помогает роли anon.
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"anon"}', true);
  set local role anon;
  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('HACK2', 'HACK2', 'HACK2'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B21', s = '42501', 'anon с подделанным sub админа не может писать: ' || s);
  set local role anon;
  s := 'ok'; begin perform public.is_admin(); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('B22', s = '42501', 'anon с подделанным sub не может вызвать is_admin: ' || s);
  perform set_config('request.jwt.claims', '', true);

  -- Данные не изменились.
  perform gds_test.check('B23',
    (select count(*) from public.brands where name like 'HACK%') = 0
    and (select count(*) from public.products where description = 'HACK' or slug = 'hack') = 0
    and (select count(*) from public.categories where name = 'HACK') = 0
    and (select count(*) from public.stores where name = 'HACK') = 0
    and (select count(*) from public.user_roles) = 2
    and (select count(*) from public.products) = 12,
    'после всех попыток anon данные не изменились');
end $$;

-- U: обычный вошедший пользователь C (не админ) --------------------------------------
do $$
declare
  n_products int; n_inactive int; n_brands int; n_img int; n_stores int; n_roles int;
  v_admin boolean; s text; v_rows int; v_brand uuid; v_cat uuid; v_prod uuid;
begin
  select id into v_brand from public.brands where name = 'GDS Джедес';
  select id into v_cat from public.categories where slug = 'hookah-tobacco';
  select id into v_prod from public.products where slug = 'altair';

  perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n_products from public.products;
  select count(*) into n_inactive from public.products where is_active = false;
  select count(*) into n_brands from public.brands;
  select count(*) into n_img from public.product_images;
  select count(*) into n_stores from public.stores;
  select count(*) into n_roles from public.user_roles;
  select public.is_admin() into v_admin;
  reset role;
  perform gds_test.check('U01', n_products = 10, 'обычный пользователь видит те же 10 активных вкусов: ' || n_products);
  perform gds_test.check('U02', n_inactive = 0, 'обычный пользователь не видит неактивных вкусов: ' || n_inactive);
  perform gds_test.check('U03', n_brands = 1 and n_stores = 1 and n_img = 1,
    'обычный пользователь видит то же, что anon: брендов ' || n_brands || ', точек ' || n_stores || ', картинок ' || n_img);
  perform gds_test.check('U04', n_roles = 0, 'обычный пользователь не видит чужих ролей (ни админских): ' || n_roles);
  perform gds_test.check('U05', v_admin = false, 'is_admin() для обычного пользователя = false');

  -- INSERT: отказ политикой RLS (42501), строки валидны, поэтому причина именно RLS.
  set local role authenticated;
  s := 'ok'; begin insert into public.brands (name, full_name, country) values ('HACK', 'HACK', 'HACK'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U10', s = '42501', 'пользователь INSERT brands: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into public.categories (name, slug) values ('HACK', 'hack'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U11', s = '42501', 'пользователь INSERT categories: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'HACK', 'hack', 'L', 'D'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U12', s = '42501', 'пользователь INSERT products: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://example.test/hack.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U13', s = '42501', 'пользователь INSERT product_images: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('HACK', 'A', 'C', 1, 1); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U14', s = '42501', 'пользователь INSERT stores: ' || s);

  -- UPDATE и DELETE: ошибки нет, затронуто 0 строк (RLS), данные целы.
  set local role authenticated;
  update public.brands set name = 'HACKED' where is_active; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U20', v_rows = 0, 'пользователь UPDATE brands: затронуто ' || v_rows);
  set local role authenticated;
  update public.categories set name = 'HACKED' where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U21', v_rows = 0, 'пользователь UPDATE categories: затронуто ' || v_rows);
  set local role authenticated;
  update public.products set description = 'HACKED' where is_active; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U22', v_rows = 0, 'пользователь UPDATE products: затронуто ' || v_rows);
  set local role authenticated;
  update public.product_images set image_url = 'https://example.test/hacked.jpg' where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U23', v_rows = 0, 'пользователь UPDATE product_images: затронуто ' || v_rows);
  set local role authenticated;
  update public.stores set name = 'HACKED' where is_active; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U24', v_rows = 0, 'пользователь UPDATE stores: затронуто ' || v_rows);

  set local role authenticated;
  delete from public.product_images where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U30', v_rows = 0, 'пользователь DELETE product_images: затронуто ' || v_rows);
  set local role authenticated;
  delete from public.products where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U31', v_rows = 0, 'пользователь DELETE products: затронуто ' || v_rows);
  set local role authenticated;
  delete from public.stores where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U32', v_rows = 0, 'пользователь DELETE stores: затронуто ' || v_rows);
  set local role authenticated;
  delete from public.brands where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U33', v_rows = 0, 'пользователь DELETE brands: затронуто ' || v_rows);
  set local role authenticated;
  delete from public.categories where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('U34', v_rows = 0, 'пользователь DELETE categories: затронуто ' || v_rows);

  -- user_roles: ни записи, ни самоназначение роли.
  set local role authenticated;
  s := 'ok'; begin insert into public.user_roles (id, role) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U40', s = '42501', 'пользователь не может назначить себе роль admin (INSERT): ' || s);
  set local role authenticated;
  s := 'ok'; begin update public.user_roles set role = 'admin' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U41', s = '42501', 'пользователь UPDATE user_roles: ' || s);
  set local role authenticated;
  s := 'ok'; begin delete from public.user_roles where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U42', s = '42501', 'пользователь DELETE user_roles: ' || s);
  set local role authenticated;
  s := 'ok'; begin truncate public.products; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('U43', s = '42501', 'пользователь TRUNCATE products: ' || s);

  perform set_config('request.jwt.claims', '', true);

  -- Данные не изменились.
  perform gds_test.check('U50',
    (select count(*) from public.brands where name = 'GDS Джедес') = 1
    and (select count(*) from public.products where description = 'HACKED' or slug = 'hack') = 0
    and (select count(*) from public.categories where name = 'HACKED') = 0
    and (select count(*) from public.stores where name = 'HACKED') = 0
    and (select count(*) from public.product_images) = 3
    and (select count(*) from public.products) = 12
    and (select count(*) from public.user_roles) = 2,
    'после всех попыток обычного пользователя данные не изменились');
end $$;

-- D: админ A ---------------------------------------------------------------------------
do $$
declare
  n_products int; n_inactive int; n_brands int; n_cat int; n_img int; n_stores int; n_roles int;
  v_admin boolean; v_role_id uuid; s text; v_rows int;
  v_brand uuid; v_cat uuid; v_new_brand uuid; v_new_cat uuid; v_new_prod uuid; v_new_img uuid; v_new_store uuid;
  v_updated timestamptz;
begin
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into n_products from public.products;
  select count(*) into n_inactive from public.products where is_active = false;
  select count(*) into n_brands from public.brands;
  select count(*) into n_cat from public.categories;
  select count(*) into n_img from public.product_images;
  select count(*) into n_stores from public.stores;
  select count(*) into n_roles from public.user_roles;
  select id into v_role_id from public.user_roles limit 1;
  select public.is_admin() into v_admin;
  select id into v_brand from public.brands where name = 'GDS Джедес';
  select id into v_cat from public.categories where slug = 'hookah-tobacco';
  reset role;

  perform gds_test.check('D01', v_admin = true, 'is_admin() для админа = true');
  perform gds_test.check('D02', n_products = 12 and n_inactive = 1,
    'админ видит все 12 вкусов, включая неактивные: всего ' || n_products || ', неактивных ' || n_inactive);
  perform gds_test.check('D03', n_brands = 2 and n_stores = 2 and n_img = 3 and n_cat = 1,
    'админ видит все бренды, точки, картинки: ' || n_brands || '/' || n_stores || '/' || n_img || '/' || n_cat);
  perform gds_test.check('D04', n_roles = 1 and v_role_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'админ A в user_roles видит только свою строку (строка админа B скрыта): ' || n_roles);

  -- Админ пишет во все пять таблиц каталога: вставка, изменение, удаление.
  set local role authenticated;
  insert into public.brands (name, full_name, country) values ('ZZ Admin Brand', 'ZZ Admin Brand Full', 'Test') returning id into v_new_brand;
  update public.brands set description = 'edited' where id = v_new_brand; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D10', v_new_brand is not null and v_rows = 1, 'админ INSERT и UPDATE brands');
  set local role authenticated;
  delete from public.brands where id = v_new_brand; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D11', v_rows = 1, 'админ DELETE brands');

  set local role authenticated;
  insert into public.categories (name, slug) values ('ZZ Admin Category', 'zz-admin-category') returning id into v_new_cat;
  update public.categories set name = 'ZZ Admin Category 2' where id = v_new_cat; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D12', v_new_cat is not null and v_rows = 1, 'админ INSERT и UPDATE categories');
  set local role authenticated;
  delete from public.categories where id = v_new_cat; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D13', v_rows = 1, 'админ DELETE categories');

  set local role authenticated;
  insert into public.products (brand_id, category_id, name, slug, line, description)
  values (v_brand, v_cat, 'ZZ Admin Product', 'zz-admin-product', 'Test', 'Test description') returning id into v_new_prod;
  update public.products set description = 'Test description 2' where id = v_new_prod; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D14', v_new_prod is not null and v_rows = 1, 'админ INSERT и UPDATE products');
  select updated_at into v_updated from public.products where id = v_new_prod;
  perform gds_test.check('D15', v_updated is not null, 'админский UPDATE проставил updated_at (триггер сработал без права на функцию)');

  set local role authenticated;
  insert into public.product_images (product_id, image_url, sort_order)
  values (v_new_prod, 'https://example.test/admin.jpg', 1) returning id into v_new_img;
  update public.product_images set sort_order = 2 where id = v_new_img; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D16', v_new_img is not null and v_rows = 1, 'админ INSERT и UPDATE product_images');
  set local role authenticated;
  delete from public.product_images where id = v_new_img; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D17', v_rows = 1, 'админ DELETE product_images');

  set local role authenticated;
  insert into public.stores (name, address, city, latitude, longitude) values ('ZZ Admin Store', 'A', 'C', 1, 1) returning id into v_new_store;
  update public.stores set city = 'City 2' where id = v_new_store; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D18', v_new_store is not null and v_rows = 1, 'админ INSERT и UPDATE stores');
  set local role authenticated;
  delete from public.stores where id = v_new_store; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('D19', v_rows = 1, 'админ DELETE stores');

  -- Админ подделывает updated_at: триггер перезаписывает.
  set local role authenticated;
  update public.products set updated_at = '2001-01-01 00:00:00+00' where id = v_new_prod;
  reset role;
  select updated_at into v_updated from public.products where id = v_new_prod;
  perform gds_test.check('D20', v_updated > '2020-01-01'::timestamptz, 'админ не может выставить updated_at руками');

  -- Удаление вкуса удаляет его картинки (каскад идёт и от имени админа).
  set local role authenticated;
  insert into public.product_images (product_id, image_url) values (v_new_prod, 'https://example.test/c1.jpg');
  delete from public.products where id = v_new_prod; get diagnostics v_rows = row_count;
  reset role;
  perform gds_test.check('D21', v_rows = 1 and not exists (select 1 from public.product_images where product_id = v_new_prod),
    'админ DELETE products удаляет и его картинки (cascade)');

  -- Удаление бренда и категории со вкусами запрещено, даже админу.
  set local role authenticated;
  s := 'ok'; begin delete from public.brands where id = v_brand; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('D22', s = '23503', 'админ не может удалить бренд со вкусами (restrict): ' || s);
  set local role authenticated;
  s := 'ok'; begin delete from public.categories where id = v_cat; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('D23', s = '23503', 'админ не может удалить категорию со вкусами (restrict): ' || s);

  -- Админ не может менять user_roles и обрезать таблицы.
  set local role authenticated;
  s := 'ok'; begin insert into public.user_roles (id, role) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('D30', s = '42501', 'админ не может выдать роль через REST (INSERT user_roles): ' || s);
  set local role authenticated;
  s := 'ok'; begin update public.user_roles set role = 'admin' where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('D31', s = '42501', 'админ UPDATE user_roles: ' || s);
  set local role authenticated;
  s := 'ok'; begin delete from public.user_roles where true; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('D32', s = '42501', 'админ DELETE user_roles: ' || s);
  set local role authenticated;
  s := 'ok'; begin truncate public.products; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('D33', s = '42501', 'админ TRUNCATE products: ' || s);

  perform set_config('request.jwt.claims', '', true);
end $$;

-- E: крайние случаи входа (JWT) ----------------------------------------------------------
do $$
declare v_admin boolean; n_roles int; n_products int; s text;
begin
  -- Вошедший, но без sub: auth.uid() пуст, админом не считается.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  select public.is_admin() into v_admin;
  select count(*) into n_roles from public.user_roles;
  select count(*) into n_products from public.products;
  reset role;
  perform gds_test.check('E01', v_admin = false and n_roles = 0 and n_products = 10,
    'вход без sub: не админ, ролей не видит, каталог как у anon');

  -- Пустые claims.
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  select public.is_admin() into v_admin;
  reset role;
  perform gds_test.check('E02', v_admin = false, 'пустые claims: is_admin() = false');

  -- sub неизвестного пользователя.
  perform set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}', true);
  set local role authenticated;
  select public.is_admin() into v_admin;
  reset role;
  perform gds_test.check('E03', v_admin = false, 'sub без строки в user_roles: is_admin() = false');

  -- Испорченный sub: ни при каких условиях не админ (ошибка или false).
  perform set_config('request.jwt.claims', '{"sub":"not-a-uuid","role":"authenticated"}', true);
  set local role authenticated;
  v_admin := null;
  s := 'ok'; begin select public.is_admin() into v_admin; exception when others then s := sqlstate; end;
  reset role;
  perform gds_test.check('E04', v_admin is distinct from true and s in ('ok', '22P02'),
    'испорченный sub не даёт прав админа (результат ' || coalesce(v_admin::text, 'ошибка') || ', код ' || s || ')');

  -- Роль «admin» в самом токене ничего не значит: решает только user_roles.
  perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","user_role":"admin","app_metadata":{"role":"admin"}}', true);
  set local role authenticated;
  select public.is_admin() into v_admin;
  reset role;
  perform gds_test.check('E05', v_admin = false, 'поля admin в самом токене прав не дают: is_admin() = false');

  perform set_config('request.jwt.claims', '', true);
end $$;

-- K: upsert (INSERT ... ON CONFLICT) и блокировки строк (SELECT ... FOR UPDATE, FOR SHARE) -----
-- Блокировка строки требует права UPDATE и проходит через политику UPDATE: так у
-- обычного пользователя получается 0 строк, а anon получает отказ по правам.
do $$
declare
  s text; n int; v_rows int; v_brand uuid; v_desc text;
begin
  select id into v_brand from public.brands where name = 'GDS Джедес';

  set local role anon;
  s := 'ok'; begin insert into public.brands (id, name, full_name, country) values (v_brand, 'HACK', 'HACK', 'HACK') on conflict (id) do update set name = excluded.name; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('K01', s = '42501', 'anon: INSERT ... ON CONFLICT DO UPDATE отклонён: ' || s);
  set local role anon;
  s := 'ok'; begin insert into public.brands (id, name, full_name, country) values (v_brand, 'HACK', 'HACK', 'HACK') on conflict (id) do nothing; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('K02', s = '42501', 'anon: INSERT ... ON CONFLICT DO NOTHING отклонён: ' || s);
  set local role anon;
  s := 'ok'; begin perform id from public.brands for update; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('K03', s = '42501', 'anon: SELECT FOR UPDATE отклонён: ' || s);
  set local role anon;
  s := 'ok'; begin perform id from public.brands for share; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('K04', s = '42501', 'anon: SELECT FOR SHARE отклонён: ' || s);

  perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
  set local role authenticated;
  s := 'ok'; begin insert into public.brands (id, name, full_name, country) values (v_brand, 'HACK', 'HACK', 'HACK') on conflict (id) do update set name = excluded.name; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('K11', s = '42501', 'обычный пользователь: INSERT ... ON CONFLICT DO UPDATE отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into public.brands (id, name, full_name, country) values (v_brand, 'HACK', 'HACK', 'HACK') on conflict (id) do nothing; exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('K12', s = '42501', 'обычный пользователь: INSERT ... ON CONFLICT DO NOTHING отклонён: ' || s);
  set local role authenticated;
  select count(*) into n from (select id from public.brands for update) q;
  reset role; perform gds_test.check('K13', n = 0, 'обычный пользователь: SELECT FOR UPDATE не блокирует ни одной строки: ' || n);
  set local role authenticated;
  select count(*) into n from (select id from public.brands for share) q;
  reset role; perform gds_test.check('K14', n = 0, 'обычный пользователь: SELECT FOR SHARE не блокирует ни одной строки: ' || n);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  set local role authenticated;
  insert into public.brands (id, name, full_name, country, description)
  values (v_brand, 'GDS Джедес', 'Generation & Delivery Smoke', 'Россия', 'upsert-by-admin')
  on conflict (id) do update set description = excluded.description;
  get diagnostics v_rows = row_count;
  select count(*) into n from (select id from public.brands for update) q;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select description into v_desc from public.brands where id = v_brand;
  perform gds_test.check('K20', v_rows = 1 and v_desc = 'upsert-by-admin', 'админ: INSERT ... ON CONFLICT DO UPDATE работает');
  perform gds_test.check('K21', n = 2, 'админ: SELECT FOR UPDATE блокирует все строки, включая скрытые: ' || n);
end $$;

-- F: видимость меняется вместе с флагами is_active ----------------------------------------
do $$
declare n int; n_img int;
begin
  -- Включили скрытый бренд: виден и его вкус, и картинка этого вкуса.
  update public.brands set is_active = true where id = '11111111-1111-4111-8111-111111111111';
  set local role anon;
  select count(*) into n from public.products where slug = 'zz-under-hidden-brand';
  select count(*) into n_img from public.product_images where product_id = '33333333-3333-4333-8333-333333333333';
  reset role;
  perform gds_test.check('F01', n = 1 and n_img = 1, 'активный бренд снова показывает свой вкус и его картинку');
  update public.brands set is_active = false where id = '11111111-1111-4111-8111-111111111111';

  -- Выключили вкус: пропадает он сам и его картинка.
  update public.products set is_active = false where slug = 'altair';
  set local role anon;
  select count(*) into n from public.products;
  select count(*) into n_img from public.product_images;
  reset role;
  perform gds_test.check('F02', n = 9 and n_img = 0, 'неактивный вкус скрыт вместе с картинкой: вкусов ' || n || ', картинок ' || n_img);
  update public.products set is_active = true where slug = 'altair';

  -- Выключили основной бренд: весь каталог пропал у публики.
  update public.brands set is_active = false where name = 'GDS Джедес';
  set local role anon;
  select count(*) into n from public.products;
  select count(*) into n_img from public.product_images;
  reset role;
  perform gds_test.check('F03', n = 0 and n_img = 0, 'неактивный бренд скрывает все свои вкусы и картинки: ' || n || '/' || n_img);

  -- Админ при этом видит всё.
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.products;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform gds_test.check('F04', n = 12, 'админ видит все вкусы и при неактивном бренде: ' || n);
  update public.brands set is_active = true where name = 'GDS Джедес';

  -- Скрытую точку админ видит, anon нет.
  set local role anon;
  select count(*) into n from public.stores;
  reset role;
  perform gds_test.check('F05', n = 1, 'anon видит только активные точки: ' || n);
end $$;

rollback;

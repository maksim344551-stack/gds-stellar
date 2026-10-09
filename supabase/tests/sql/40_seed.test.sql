-- =============================================================================
-- 40_seed.test.sql: содержимое 004_seed.sql совпадает с ТЗ.
-- ТЕСТОВЫЙ ФАЙЛ, не для боевой базы. Запускается из supabase/tests/run.mjs.
-- =============================================================================
-- Это «золотой» тест: тексты продублированы здесь намеренно. Если вы правите
-- описания в 004_seed.sql, обновите и этот файл.
-- Телефон, e-mail, адрес и координаты взяты из ТЗ без изменений и НЕ проверялись
-- на соответствие реальности.
-- =============================================================================

begin;

-- SD01: бренд -------------------------------------------------------------------------
do $$
declare r public.brands;
begin
  perform gds_test.check('SD01a', (select count(*) from public.brands) = 1, 'в brands ровно одна строка');
  select * into r from public.brands where name = 'GDS Джедес';
  perform gds_test.check('SD01b',
    r.full_name = 'Generation & Delivery Smoke' and r.country = 'Россия' and r.is_active
    and r.logo_url is null,
    'бренд: GDS Джедес / Generation & Delivery Smoke / Россия, активен, логотипа пока нет');
  perform gds_test.check('SD01c',
    r.description like '%оберточный сигарный лист%' and r.description like '%Берли%'
    and r.description like '%Вирджиния Ред в обработке Кавендиш%'
    and r.description like '%Вирджиния Голд естественной ферментации%'
    and r.description like '%25 г%' and r.description like '%термос-полусфера%'
    and r.description like '%отсекателем%' and r.description like '%обечайка%',
    'описание бренда содержит купаж из 4 сортов и фасовку из ТЗ');
end $$;

-- SD02: категория ---------------------------------------------------------------------
do $$
begin
  perform gds_test.check('SD02',
    (select count(*) from public.categories) = 1
    and exists (select 1 from public.categories where name = 'Кальянный табак' and slug = 'hookah-tobacco'),
    'одна категория: Кальянный табак / hookah-tobacco');
end $$;

-- SD03: десять вкусов: имена, slug, ароматические ноты и описания -------------------------
do $$
declare diff int; n int;
begin
  select count(*) into n from public.products;
  perform gds_test.check('SD03a', n = 10, 'в products ровно 10 строк: ' || n);

  with actual as (
    select name || '|' || slug || '|' || aroma_profile || '|' || description as s from public.products
  ),
  expected (s) as (values
    ('Altair|altair|мята|Холодная сладкая мята с оттенком американских мятных леденцов.'),
    ('Betelgeuse|betelgeuse|роза, виноград|Цветочный аромат розы с фруктовыми оттенками винограда и лёгкой кислинкой.'),
    ('Vega|vega|лесные ягоды|Ягодный профиль с нотами черники, сандала и железного дерева.'),
    ('Naos|naos|орчата|Молочный аромат мексиканского напитка с корицей и миндалём.'),
    ('Proxima|proxima|лимон, лайм|Сладкий лимонный леденец с нотами лаймовой цедры.'),
    ('Sirius|sirius|чистый купаж|Без ароматических добавок. Ноты шоколада от обработки Кавендиш, лёгкие фруктовые ноты Вирджинии, крепость оберточного листа.'),
    ('Alcor|alcor|нектарин, ананас|Сочетание нектарина и ананаса.'),
    ('Capella|capella|мускусный виноград|Цветочный профиль с белым мускусным виноградом.'),
    ('Mira|mira|вишня, ванильная кола|Аромат газированного вишнёвого напитка с оттенками ванильной колы.'),
    ('Isida|isida|сладкий душистый|Сладкий душистый профиль.')
  )
  select count(*) into diff from (
    (select s from actual except select s from expected)
    union all
    (select s from expected except select s from actual)
  ) d;
  perform gds_test.check('SD03b', diff = 0, 'названия, slug, ноты и описания совпадают с ТЗ, расхождений: ' || diff);

  select count(*) into n
  from public.products p
  join public.brands b on b.id = p.brand_id and b.name = 'GDS Джедес'
  join public.categories c on c.id = p.category_id and c.slug = 'hookah-tobacco'
  where p.line = 'Stellar' and p.weight_g = 25 and p.is_active
    and p.tagline is null and p.nicotine_mg is null and p.updated_at is null;
  perform gds_test.check('SD03c', n = 10,
    'у всех 10: бренд GDS, категория hookah-tobacco, линейка Stellar, 25 г, активны, подпись и крепость не указаны: ' || n);

  perform gds_test.check('SD03d',
    (select array_agg(slug order by created_at) from public.products)
      = array['altair', 'betelgeuse', 'vega', 'naos', 'proxima', 'sirius', 'alcor', 'capella', 'mira', 'isida']
    and (select count(distinct created_at) from public.products) = 10,
    'сортировка по created_at даёт порядок вкусов из ТЗ (Altair, Betelgeuse, Vega, Naos, Proxima, Sirius, Alcor, Capella, Mira, Isida), все created_at различны');
end $$;

-- SD04: точка продаж ------------------------------------------------------------------
do $$
declare r public.stores;
begin
  perform gds_test.check('SD04a', (select count(*) from public.stores) = 1, 'в stores ровно одна строка');
  select * into r from public.stores limit 1;
  perform gds_test.check('SD04b',
    r.name = 'GDS, Колпино, Финляндская 35'
    and r.address = 'Россия, Санкт-Петербург, Колпино, Финляндская ул., 35'
    and r.city = 'Санкт-Петербург'
    and r.latitude = 59.7479 and r.longitude = 30.5884
    and r.phone = '8 800 300-49-99' and r.email = 'mtechno.tobacco@gmail.com'
    and r.working_hours is null and r.is_active,
    'точка продаж совпадает с ТЗ (координаты не проверялись)');
end $$;

-- SD05: нейтральность текстов (эвристика, не юридическая проверка) -------------------------
-- Список слов запрещённых призывов, оценок и утверждений о пользе: заведомо
-- неполный. Он ловит случайную порчу текста при правках, но не заменяет
-- проверку юристом.
do $$
declare n int;
begin
  select count(*) into n
  from (
    select description as t from public.products
    union all select aroma_profile from public.products
    union all select tagline from public.products
    union all select description from public.brands
  ) x
  where t ~* '(лучш|идеальн|превосходн|великолепн|потрясающ|невероятн|уникальн|эксклюзив|скидк|акци[яиюе]|купи|закаж|цен[аы]|руб|дешев|дёшев|бесплатн|рекоменд|наслажд|удовольств|премиум|популярн|бестселлер|здоров|безвредн|безопасн|не вредит)';
  perform gds_test.check('SD05', n = 0, 'в текстах нет слов из списка продающих оценок и утверждений о пользе: найдено ' || n);
end $$;

-- SD06: сид не создаёт ролей и пользователей ----------------------------------------------
do $$
begin
  perform gds_test.check('SD06', (select count(*) from public.user_roles) = 0 and (select count(*) from auth.users) = 0,
    'сид не создаёт ни пользователей, ни ролей, ни паролей');
end $$;

rollback;

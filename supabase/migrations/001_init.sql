-- =============================================================================
-- 001_init.sql
-- GDS «Джедес» (Generation & Delivery Smoke): схема справочника продукции.
-- =============================================================================
-- Что делает файл:
--   1. подключает расширение pgcrypto (в схему extensions, а не в public);
--   2. создаёт 6 таблиц: brands, categories, products, product_images, stores,
--      user_roles;
--   3. ставит ограничения значений (формат slug, диапазоны координат, https в
--      ссылках на картинки, длины текстов), индексы и триггер updated_at;
--   4. сразу ЗАКРЫВАЕТ таблицы: включает RLS (политик пока нет, значит всё
--      запрещено) и отзывает служебные права TRUNCATE, REFERENCES, TRIGGER, на
--      которые RLS не действует. Остальные права и политики выдаёт 002_rls.sql.
--      Так нет промежутка, когда свежесозданные таблицы доступны всем.
--
-- Как выполнять: Supabase -> SQL Editor -> New query -> вставить файл целиком
-- -> Run. Ожидаемый ответ: «Success. No rows returned».
-- Порядок: 001, 002, 003, 004.
-- Повторный запуск этого файла безопасен: он ничего не дублирует, не удаляет
-- данные и не отнимает права, которые выдал 002 (drop относится только к
-- триггеру, который создаёт этот же файл).
--
-- Сайт информационный: цен, заказов и корзины в схеме нет и быть не должно.
-- Тексты в таблицах только нейтральные (характеристики продукта).
-- =============================================================================

begin;

-- 1. Расширение -------------------------------------------------------------
-- gen_random_uuid() встроена в PostgreSQL начиная с 13 версии, но ТЗ просит
-- pgcrypto, поэтому оно подключается. Схема extensions нужна, чтобы функции
-- расширения (digest, crypt, ...) не попали в публичную схему public и не
-- стали вызываемыми через REST.
create extension if not exists pgcrypto with schema extensions;

-- 2. Функция-триггер для updated_at -----------------------------------------
-- search_path пустой: все имена внутри полностью квалифицированы (защита от
-- подмены объектов). Менять updated_at руками нельзя: триггер всегда
-- перезаписывает значение.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Эту функцию вызывает только триггер. Права на вызов через REST не нужны.
-- (Триггер сработает и без них: право EXECUTE проверяется при создании
-- триггера, а не при каждом срабатывании.)
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- Правила для текстовых колонок ниже (одни и те же везде):
--   * длина ограничена сверху;
--   * строка не может состоять из одних пробельных или невидимых знаков (пробел,
--     табуляция, перевод строки, неразрывный пробел U+00A0, знаки нулевой ширины
--     U+200B-U+200D, U+2060, U+FEFF): проверка требует хотя бы один другой знак.
--     В самих проверках эти знаки записаны escape-последовательностями, а не
--     невидимыми символами.

-- 3. brands: бренд ----------------------------------------------------------
create table if not exists public.brands (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,                       -- 'GDS Джедес'
  full_name   text        not null,                       -- 'Generation & Delivery Smoke'
  country     text        not null,                       -- 'Россия'
  description text,                                       -- нейтральное описание бренда
  logo_url    text,                                       -- ссылка на файл в Storage (бакет brand-logos)
  is_active   boolean     not null default true,          -- false: бренд и его вкусы скрыты от публики
  created_at  timestamptz not null default now(),
  constraint brands_name_len        check (char_length(name) between 1 and 200 and name ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint brands_full_name_len   check (char_length(full_name) between 1 and 200 and full_name ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint brands_country_len     check (char_length(country) between 1 and 100 and country ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint brands_description_len check (description is null or char_length(description) <= 4000),
  -- Ссылка: только https и узкий набор символов: латиница, цифры и . _ ~ : / ? # % & = + -
  -- (нет пробелов, кавычек, < > \ ( ) ; , ! $ * [ ] @, поэтому ни вставка в HTML-атрибут,
  -- ни в CSS url(...), ни приём «https://хороший@плохой/» через этот столбец не пройдёт).
  constraint brands_logo_url_https  check (
    logo_url is null
    or (char_length(logo_url) <= 2048 and logo_url ~ '^https://[A-Za-z0-9._~:/?#%&=+-]+$')
  )
);

-- 4. categories: категория --------------------------------------------------
-- В таблице нет is_active (так в ТЗ): категории видны всем целиком, а вкусы
-- скрываются через products.is_active.
create table if not exists public.categories (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,                        -- 'Кальянный табак'
  slug       text        not null,                        -- 'hookah-tobacco'
  created_at timestamptz not null default now(),
  constraint categories_slug_key    unique (slug),
  constraint categories_name_len    check (char_length(name) between 1 and 200 and name ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  -- латиница в нижнем регистре, цифры, дефис между частями
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64)
);

-- 5. products: вкусы (товары) -----------------------------------------------
-- Удаление бренда или категории, у которых есть вкусы, ЗАПРЕЩЕНО (restrict):
-- так один неверный клик не стирает весь каталог. Чтобы убрать бренд или вкус
-- с сайта, ставится is_active = false. (В ТЗ здесь стоял cascade; отступление
-- записано в docs/adr/0001-supabase-backend.md.)
create table if not exists public.products (
  id            uuid          primary key default gen_random_uuid(),
  brand_id      uuid          not null,
  category_id   uuid          not null,
  name          text          not null,                   -- название вкуса: 'Altair'
  slug          text          not null,                   -- 'altair'
  line          text          not null,                   -- линейка: 'Stellar'
  tagline       text,                                     -- 'Discover Star' (может быть null)
  description   text          not null,                   -- нейтральное описание ароматического профиля
  aroma_profile text,                                     -- краткая нота: 'мята'
  weight_g      numeric(6,2)  not null default 25,        -- вес банки, граммы
  nicotine_mg   numeric(4,2),                             -- крепость в никотиновом эквиваленте; null: неизвестна
  is_active     boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz,                              -- ставит триггер при изменении строки; у ещё не менявшихся строк пусто
  constraint products_brand_id_fkey    foreign key (brand_id)    references public.brands (id)     on delete restrict,
  constraint products_category_id_fkey foreign key (category_id) references public.categories (id) on delete restrict,
  constraint products_slug_key         unique (slug),
  constraint products_slug_format      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  constraint products_name_len         check (char_length(name) between 1 and 200 and name ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint products_line_len         check (char_length(line) between 1 and 100 and line ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint products_tagline_len      check (tagline is null or (char_length(tagline) between 1 and 200 and tagline ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]')),
  constraint products_description_len  check (char_length(description) between 1 and 4000 and description ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint products_aroma_len        check (aroma_profile is null or (char_length(aroma_profile) between 1 and 200 and aroma_profile ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]')),
  -- between отвергает и NaN (у numeric NaN «больше всех чисел», обычное «> 0» его пропускает)
  constraint products_weight_range     check (weight_g between 0.01 and 9999.99),
  constraint products_nicotine_range   check (nicotine_mg is null or nicotine_mg between 0 and 99.99)
);

-- 6. product_images: картинки вкуса -----------------------------------------
-- Удаление вкуса удаляет его картинки из таблицы (cascade, как в ТЗ). Сами
-- файлы в Storage при этом остаются: их удаляют отдельно через Storage.
create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  image_url  text not null,                               -- ссылка на файл в Storage (бакет product-images)
  sort_order int  not null default 0,
  constraint product_images_product_id_fkey foreign key (product_id) references public.products (id) on delete cascade,
  constraint product_images_url_https       check (
    char_length(image_url) <= 2048 and image_url ~ '^https://[A-Za-z0-9._~:/?#%&=+-]+$'
  )
);

-- 7. stores: точки продаж и контакты ----------------------------------------
create table if not exists public.stores (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  address       text        not null,
  city          text        not null,
  latitude      float8      not null,
  longitude     float8      not null,
  phone         text,
  email         text,
  working_hours text,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  constraint stores_name_len      check (char_length(name) between 1 and 200 and name ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint stores_address_len   check (char_length(address) between 1 and 500 and address ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  constraint stores_city_len      check (char_length(city) between 1 and 100 and city ~ '[^[:space:]\u00A0\u200B-\u200D\u2060\uFEFF]'),
  -- between отвергает и NaN, и бесконечность
  constraint stores_latitude_range  check (latitude  between -90  and 90),
  constraint stores_longitude_range check (longitude between -180 and 180),
  -- телефон: цифры, пробелы и + ( ) -, не короче 5 знаков и хотя бы одна цифра
  constraint stores_phone_format  check (phone is null or (phone ~ '^[0-9+() -]{5,32}$' and phone ~ '[0-9]')),
  -- e-mail: латиница, цифры и . _ % + - в имени; домен из частей латиницы и цифр (дефис
  -- только внутри части), разделённых точками; зона от двух букв. Кавычек, < > & ; \ и
  -- пробелов нет.
  constraint stores_email_format  check (
    email is null
    or (char_length(email) <= 254
        and email ~ '^[A-Za-z0-9._%+-]+@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$')
  ),
  constraint stores_hours_len     check (working_hours is null or char_length(working_hours) <= 500)
);

-- 8. user_roles: роли пользователей -----------------------------------------
-- Строки сюда добавляет только владелец вручную (SQL Editor), через REST
-- записать сюда нельзя: политик на запись нет (см. 002_rls.sql).
-- Удаление пользователя в Auth удаляет и его роль (cascade, как в ТЗ).
-- Значение role по умолчанию 'admin' взято из ТЗ. Пока единственная роль
-- admin и записи делает только владелец вручную, это безопасно; если появятся
-- другие роли, значение по умолчанию надо убрать новой миграцией.
create table if not exists public.user_roles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  role       text        not null default 'admin',
  created_at timestamptz not null default now(),
  constraint user_roles_role_check check (role in ('admin'))
);

-- 9. Индексы ----------------------------------------------------------------
create index if not exists products_brand_id_idx       on public.products (brand_id);
create index if not exists products_category_id_idx    on public.products (category_id);
create index if not exists products_is_active_idx      on public.products (is_active);
-- Индекс по products(slug) из ТЗ уже есть: его создаёт ограничение
-- products_slug_key (unique). Второй такой же индекс только замедлял бы запись.
create index if not exists product_images_product_id_idx on public.product_images (product_id);
create index if not exists stores_is_active_idx        on public.stores (is_active);

-- 10. Триггер updated_at ----------------------------------------------------
-- Срабатывает только если строка действительно изменилась.
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row
  when (old.* is distinct from new.*)
  execute function public.set_updated_at();

-- 11. Описания для Table Editor ---------------------------------------------
comment on table public.brands         is 'Бренд. Публично видны только строки is_active = true.';
comment on table public.categories     is 'Категории продукции. Публично видны все строки.';
comment on table public.products       is 'Вкусы (продукция). Публично видны активные вкусы активного бренда.';
comment on table public.product_images is 'Картинки вкуса. Публично видны картинки активных вкусов активного бренда.';
comment on table public.stores         is 'Точки продаж и контакты. Публично видны только строки is_active = true.';
comment on table public.user_roles     is 'Роли пользователей. Строки добавляет только владелец вручную; через REST записать нельзя.';
comment on column public.products.nicotine_mg is 'Крепость в никотиновом эквиваленте, мг; null, если неизвестна.';

-- 12. Закрытое состояние по умолчанию ---------------------------------------
-- RLS включён и политик ещё нет: anon и authenticated не могут ни читать, ни
-- менять строки (владелец таблиц, роль postgres, RLS обходит). Дополнительно
-- отзываем права, на которые RLS не действует: TRUNCATE, REFERENCES, TRIGGER.
-- Остальные права (SELECT, INSERT, UPDATE, DELETE) выдаёт и отзывает 002_rls.sql;
-- здесь их не трогаем, чтобы повторный запуск этого файла не ломал уже
-- настроенный доступ.
alter table public.brands         enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.product_images enable row level security;
alter table public.stores         enable row level security;
alter table public.user_roles     enable row level security;

revoke truncate, references, trigger on table
  public.brands, public.categories, public.products,
  public.product_images, public.stores, public.user_roles
from public, anon, authenticated;

commit;

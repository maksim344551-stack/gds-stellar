-- =============================================================================
-- shim.sql: ТЕСТОВАЯ ЗАГЛУШКА. ЭТО НЕ SUPABASE.
-- =============================================================================
-- НЕ ВЫПОЛНЯТЬ В БОЕВОЙ БАЗЕ И В SUPABASE SQL EDITOR.
--
-- Зачем нужна: миграции в supabase/migrations рассчитаны на окружение Supabase
-- (роли anon, authenticated, service_role; схемы auth и storage; таблицы
-- auth.users, storage.buckets, storage.objects; функция auth.uid()). В обычном
-- одноразовом PostgreSQL этого нет. Этот файл создаёт минимальные ПОДДЕЛКИ
-- этих объектов, чтобы прогнать миграции и SQL-тесты (supabase/tests/sql) на
-- песочнице. Поддельное окружение лишь похоже на настоящее; поведение
-- настоящего Supabase этот файл не доказывает.
--
-- Защита от случайного запуска на настоящей базе:
--   1. файл не выполняется, пока в сессии не задана настройка
--      gds.sandbox_ack с точным значением из проверки ниже (её ставит только
--      run.mjs после проверки адреса и имени базы);
--   2. имя базы обязано содержать отдельным словом (через _ или -) test,
--      sandbox или tmp (у Supabase база называется postgres);
--   3. схемы auth и storage создаются БЕЗ «if not exists»: в настоящем Supabase
--      они уже есть, и файл упадёт на первой же команде.
--
-- Что воспроизводится:
--   * роли anon, authenticated (без входа), service_role (обходит RLS);
--   * права «по умолчанию» новых таблиц и функций в схеме public как в СТАРЫХ
--     проектах Supabase (всё выдано anon, authenticated, service_role). Новый
--     режим платформы (ничего не выдаётся автоматически) включает второй файл,
--     shim_strict_defaults.sql;
--   * auth.users (только колонки id, email, created_at) и auth.uid(), которая
--     читает поле sub из настройки request.jwt.claims, как настоящая;
--   * storage.buckets и storage.objects с включённым RLS и с правами, которые
--     платформа выдаёт ролям по умолчанию.
-- Что НЕ воспроизводится: сам Storage API (лимиты размера и типов файлов,
-- публичные ссылки), PostgREST, GoTrue, роль-владелец postgres без суперправ.
-- =============================================================================

do $guard$
begin
  if current_setting('gds.sandbox_ack', true) is distinct from 'DISPOSABLE-SANDBOX-NOT-SUPABASE' then
    raise exception 'shim.sql: отказ. Это тестовая заглушка, а не Supabase; запускать её можно только через supabase/tests/run.mjs на одноразовой базе.';
  end if;
  if current_database() !~ '(^|[_-])(test|sandbox|tmp)($|[_-])' then
    raise exception 'shim.sql: отказ. Имя базы должно содержать отдельным словом (через _ или -) test, sandbox или tmp.';
  end if;
end
$guard$;

begin;

-- Роли (в кластере они общие для всех баз, поэтому создаём, только если нет).
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$roles$;

-- Схемы. Без «if not exists» намеренно: в настоящем Supabase они уже есть.
create schema auth;
create schema storage;
create schema extensions;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

-- auth.users: настоящая таблица шире; для внешнего ключа user_roles хватает id.
create table auth.users (
  id         uuid primary key,
  email      text unique,
  created_at timestamptz not null default now()
);

-- auth.uid(): как в настоящем Supabase (читает sub из claims запроса).
create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- storage: минимальные копии таблиц Storage.
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create unique index bname on storage.buckets (name);

create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text,
  owner       uuid,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  metadata    jsonb
);
create unique index bucketid_objname on storage.objects (bucket_id, name);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- Права, которые Supabase выдаёт ролям на таблицы Storage (доступ ограничивает RLS).
grant all on table storage.buckets, storage.objects to anon, authenticated, service_role;

-- Права по умолчанию новых объектов схемы public: режим СТАРЫХ проектов
-- Supabase. Действуют для объектов, которые создаёт роль postgres.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;

commit;

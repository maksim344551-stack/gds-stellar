-- =============================================================================
-- 003_storage.sql
-- GDS «Джедес»: хранилище файлов (Supabase Storage): бакеты и политики.
-- =============================================================================
-- Что делает файл (две части, каждая в своей транзакции):
--   Часть 1. Создаёт два публичных бакета: product-images и brand-logos, с
--            лимитом размера файла и списком разрешённых типов (только
--            растровые картинки). Бакет без политик безопасен: загрузить в него
--            ничего нельзя, получить список файлов тоже.
--   Часть 2. Создаёт политики на storage.objects: загружать, менять и удалять
--            файлы может только админ, и только по соглашению об именах. В
--            конце проверяет итог и откатывает ЭТУ часть, если защита собрана
--            не так. Если остановится часть 2, бакеты из части 1 уже созданы.
--
-- Соглашение об именах (его проверяют политики, иначе загрузка отклоняется):
--   product-images:  <slug-вкуса>/<uuid>.<расширение>   например altair/3f2b...c9.jpg
--   brand-logos:     gds/<uuid>.<расширение>
--   uuid в нижнем регистре; расширение из списка jpg, jpeg, png, webp, avif
--   в нижнем регистре; slug как в таблице products (латиница, цифры, дефис).
--
-- ВАЖНО про чтение (по документации Supabase; на живом проекте не проверено).
-- Бакеты публичные, поэтому файл открывается по прямой
-- ссылке (…/storage/v1/object/public/<бакет>/<путь>) БЕЗ какой-либо политики.
-- Политики чтения для anon здесь нет намеренно: она дала бы любому владельцу
-- публичного ключа получать СПИСОК всех файлов бакета, в том числе загруженных,
-- но ещё не опубликованных. (В ТЗ стоит «SELECT: всем»; это отступление записано
-- в docs/adr/0001-supabase-backend.md.) Список файлов и перезапись файла видит
-- только админ (политика gds_storage_admin_read).
--
-- Ограничения типов и размера применяет сам Storage при загрузке. Проверить их
-- можно загрузкой в бакет вручную (см. docs/backend-security-checklist.md).
--
-- Как выполнять: SQL Editor -> вставить файл целиком -> Run. Ожидаемый ответ:
-- «Success. No rows returned». Повторный запуск безопасен: настройки бакетов
-- приводятся к значениям из этого файла, политики пересоздаются.
-- Выполнять после 002_rls.sql (политики вызывают public.is_admin()).
-- Если в проекте уже есть чужие политики на storage.objects (например, созданные
-- по шаблонам из панели), часть 2 остановится и назовёт их: удалите их и
-- повторите.
-- =============================================================================

-- ЧАСТЬ 1. Бакеты -----------------------------------------------------------
begin;

-- file_size_limit в байтах: 5 МиБ для картинок вкусов, 2 МиБ для логотипов.
-- allowed_mime_types: SVG не разрешён намеренно (SVG может содержать скрипты).
-- Лимит бакета не может быть больше общего лимита файла проекта (Dashboard ->
-- Storage -> Settings).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('brand-logos',    'brand-logos',    true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set name               = excluded.name,
      public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if (select count(*)
      from storage.buckets
      where id in ('product-images', 'brand-logos')
        and public
        and file_size_limit is not null
        and allowed_mime_types is not null) <> 2 then
    raise exception 'GDS 003: бакеты product-images и brand-logos настроены не так; часть 1 не применена';
  end if;
end;
$$;

commit;

-- ЧАСТЬ 2. Политики на storage.objects ---------------------------------------
begin;

-- Таблица storage.objects принадлежит Storage; RLS на ней уже включён
-- платформой, здесь он не трогается (проверка в конце файла). Все политики ниже
-- ограничены двумя нашими бакетами: на другие бакеты проекта они не действуют.

-- Админ видит список файлов обоих бакетов. Это же право нужно для перезаписи
-- существующего файла (upsert). Для anon и обычных пользователей политики
-- чтения нет: список файлов им недоступен.
drop policy if exists gds_storage_admin_read on storage.objects;
create policy gds_storage_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('product-images', 'brand-logos')
    and (select public.is_admin())
  );

-- Загружать файлы может только админ, и только с допустимым именем.
drop policy if exists gds_storage_admin_insert on storage.objects;
create policy gds_storage_admin_insert on storage.objects
  for insert to authenticated
  with check (
    (select public.is_admin())
    and (
      (bucket_id = 'product-images'
        and name ~ '^[a-z0-9]+(-[a-z0-9]+)*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$')
      or
      (bucket_id = 'brand-logos'
        and name ~ '^gds/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$')
    )
  );

-- Менять и переименовывать файлы может только админ; новое имя тоже должно
-- соответствовать соглашению.
drop policy if exists gds_storage_admin_update on storage.objects;
create policy gds_storage_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('product-images', 'brand-logos')
    and (select public.is_admin())
  )
  with check (
    (select public.is_admin())
    and (
      (bucket_id = 'product-images'
        and name ~ '^[a-z0-9]+(-[a-z0-9]+)*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$')
      or
      (bucket_id = 'brand-logos'
        and name ~ '^gds/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$')
    )
  );

-- Удалять файлы может только админ.
drop policy if exists gds_storage_admin_delete on storage.objects;
create policy gds_storage_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('product-images', 'brand-logos')
    and (select public.is_admin())
  );

-- Самопроверка итога ---------------------------------------------------------
do $$
declare
  v_unexpected text;
  v_bad integer;
begin
  -- Платформа должна была включить RLS на storage.objects. Без него все четыре
  -- политики не действуют, и роли anon и authenticated получили бы доступ ко всем
  -- файлам. Таблица принадлежит Storage, включить RLS отсюда нельзя, поэтому
  -- при выключенном RLS файл останавливается.
  if not (select c.relrowsecurity
          from pg_catalog.pg_class c
          where c.oid = 'storage.objects'::regclass) then
    raise exception 'GDS 003: на storage.objects выключен RLS; политики не применены. Сообщите разработчику';
  end if;

  -- На storage.objects только наши четыре политики. Чужие (например, созданные
  -- по шаблонам из панели «Allow public read» или «Allow authenticated uploads»)
  -- открыли бы список файлов или загрузку.
  select string_agg(p.policyname, ', ' order by p.policyname)
    into v_unexpected
  from pg_catalog.pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and p.policyname not in ('gds_storage_admin_read', 'gds_storage_admin_insert',
                             'gds_storage_admin_update', 'gds_storage_admin_delete');
  if v_unexpected is not null then
    raise exception 'GDS 003: на storage.objects есть посторонние политики (%). Удалите их (Storage -> Policies в панели) и повторите; политики не применены', v_unexpected;
  end if;

  if (select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects'
        and p.policyname in ('gds_storage_admin_read', 'gds_storage_admin_insert',
                             'gds_storage_admin_update', 'gds_storage_admin_delete')) <> 4 then
    raise exception 'GDS 003: политики Storage созданы не полностью; политики не применены';
  end if;

  -- Ни одна политика записи на storage.buckets не доступна anon, PUBLIC и
  -- authenticated (иначе обычный пользователь смог бы создавать свои бакеты).
  select count(*) into v_bad
  from pg_catalog.pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'buckets'
    and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (p.roles && array['anon', 'public', 'authenticated']::name[]);
  if v_bad > 0 then
    raise exception 'GDS 003: на storage.buckets найдено % политик записи для anon, public или authenticated; удалите их; политики не применены', v_bad;
  end if;
end;
$$;

commit;

-- =============================================================================
-- 30_storage.test.sql: бакеты и политики Storage на ЗАГЛУШКЕ storage.objects.
-- ТЕСТОВЫЙ ФАЙЛ, не для боевой базы. Запускается из supabase/tests/run.mjs.
-- =============================================================================
-- Что проверяется: настройки бакетов в таблице и политики RLS на storage.objects.
-- Чего здесь НЕТ: сам Storage API (лимит размера и разрешённые типы файлов
-- применяет он, публичная ссылка тоже его) на песочнице не воспроизводится.
-- Это проверяется на живом проекте по docs/backend-security-checklist.md.
-- =============================================================================

begin;

-- Фикстуры ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin-a@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'user-c@example.test');
insert into public.user_roles (id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin');

-- Посторонний приватный бакет: наши политики на него действовать не должны.
insert into storage.buckets (id, name, public) values ('zz-private', 'zz-private', false);

insert into storage.objects (bucket_id, name) values
  ('product-images', 'altair/3f2b9c1e-0000-4000-8000-000000000001.jpg'),
  ('brand-logos',    'gds/3f2b9c1e-0000-4000-8000-000000000002.png'),
  ('zz-private',     'secret/doc.txt');

-- T01: настройки бакетов -------------------------------------------------------------
do $$
declare
  v_pub_img boolean; v_pub_logo boolean;
  v_lim_img bigint; v_lim_logo bigint;
  v_mime_img text[]; v_mime_logo text[];
begin
  select public, file_size_limit, allowed_mime_types into v_pub_img, v_lim_img, v_mime_img
  from storage.buckets where id = 'product-images';
  select public, file_size_limit, allowed_mime_types into v_pub_logo, v_lim_logo, v_mime_logo
  from storage.buckets where id = 'brand-logos';

  perform gds_test.check('T01a', v_pub_img is true and v_pub_logo is true, 'оба бакета публичные');
  perform gds_test.check('T01b', v_lim_img = 5242880 and v_lim_logo = 2097152,
    'лимиты размера: 5 МиБ для картинок, 2 МиБ для логотипов');
  perform gds_test.check('T01c',
    v_mime_img @> array['image/jpeg', 'image/png', 'image/webp', 'image/avif'] and cardinality(v_mime_img) = 4
    and v_mime_logo @> array['image/jpeg', 'image/png', 'image/webp', 'image/avif'] and cardinality(v_mime_logo) = 4,
    'разрешены только JPEG, PNG, WebP, AVIF (SVG и прочее нет)');
  perform gds_test.check('T01d',
    (select count(*) from storage.buckets where id in ('product-images', 'brand-logos')) = 2,
    'бакеты названы product-images и brand-logos');
end $$;

-- T02: набор политик на storage.objects ----------------------------------------------
do $$
declare diff int; n int;
begin
  with actual as (
    select policyname || '|' || cmd || '|' || roles::text || '|' || permissive as s
    from pg_policies where schemaname = 'storage' and tablename = 'objects'
  ),
  expected (s) as (values
    ('gds_storage_admin_read|SELECT|{authenticated}|PERMISSIVE'),
    ('gds_storage_admin_insert|INSERT|{authenticated}|PERMISSIVE'),
    ('gds_storage_admin_update|UPDATE|{authenticated}|PERMISSIVE'),
    ('gds_storage_admin_delete|DELETE|{authenticated}|PERMISSIVE')
  )
  select count(*) into diff from (
    (select s from actual except select s from expected)
    union all
    (select s from expected except select s from actual)
  ) d;
  perform gds_test.check('T02a', diff = 0, 'на storage.objects ровно четыре админские политики, расхождений: ' || diff);

  select count(*) into n from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (roles && array['anon', 'public']::name[]);
  perform gds_test.check('T02b', n = 0, 'для anon и PUBLIC политик на storage.objects нет совсем (в том числе чтения): ' || n);

  perform gds_test.check('T02c',
    (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
    'RLS на storage.objects включён');

  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'buckets';
  perform gds_test.check('T02d', n = 0, 'на storage.buckets политик нет: обычный пользователь не может создавать бакеты: ' || n);
end $$;

-- T03: anon ----------------------------------------------------------------------------
do $$
declare n int; s text; v_rows int;
begin
  set local role anon;
  select count(*) into n from storage.objects;
  reset role;
  perform gds_test.check('T03a', n = 0, 'anon не видит ни одного файла: список недоступен (' || n || ' строк при 3 существующих)');

  set local role anon;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000a1.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T03b', s = '42501', 'anon не может загрузить файл (42501): ' || s);

  set local role anon;
  update storage.objects set name = 'altair/3f2b9c1e-0000-4000-8000-0000000000a2.jpg' where bucket_id = 'product-images'; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T03c', v_rows = 0, 'anon не может менять файлы: затронуто ' || v_rows);

  set local role anon;
  delete from storage.objects where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T03d', v_rows = 0, 'anon не может удалять файлы: затронуто ' || v_rows);

  perform gds_test.check('T03e', (select count(*) from storage.objects) = 3, 'после попыток anon все 3 файла на месте');

  set local role anon;
  s := 'ok'; begin insert into storage.buckets (id, name, public) values ('zz-evil', 'zz-evil', true); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T03f', s = '42501', 'anon не может создать бакет (42501): ' || s);
end $$;

-- T04: обычный пользователь (не админ) --------------------------------------------------
do $$
declare n int; s text; v_rows int;
begin
  perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);

  set local role authenticated;
  select count(*) into n from storage.objects;
  reset role;
  perform gds_test.check('T04a', n = 0, 'обычный пользователь не видит файлов: ' || n);

  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000a1.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T04b', s = '42501', 'обычный пользователь не может загрузить файл (42501): ' || s);

  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('brand-logos', 'gds/3f2b9c1e-0000-4000-8000-0000000000a1.png'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T04c', s = '42501', 'обычный пользователь не может загрузить логотип (42501): ' || s);

  set local role authenticated;
  update storage.objects set name = 'altair/3f2b9c1e-0000-4000-8000-0000000000a2.jpg' where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T04d', v_rows = 0, 'обычный пользователь не может менять файлы: затронуто ' || v_rows);

  set local role authenticated;
  delete from storage.objects where true; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T04e', v_rows = 0, 'обычный пользователь не может удалять файлы: затронуто ' || v_rows);

  set local role authenticated;
  s := 'ok'; begin insert into storage.buckets (id, name, public) values ('zz-evil', 'zz-evil', true); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T04g', s = '42501', 'обычный пользователь не может создать бакет (42501): ' || s);

  perform set_config('request.jwt.claims', '', true);
  perform gds_test.check('T04f', (select count(*) from storage.objects) = 3, 'после попыток пользователя все 3 файла на месте');
end $$;

-- T05: админ A: чтение --------------------------------------------------------------------
do $$
declare n int; n_private int;
begin
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from storage.objects;
  select count(*) into n_private from storage.objects where bucket_id = 'zz-private';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform gds_test.check('T05a', n = 2, 'админ видит файлы своих двух бакетов: ' || n);
  perform gds_test.check('T05b', n_private = 0, 'админ не видит файлов постороннего бакета: ' || n_private);
end $$;

-- T06: админ A: загрузка по соглашению об именах ---------------------------------------------
do $$
declare s text;
begin
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

  -- Допустимые имена.
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000a1.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06a', s = 'ok', 'jpg по соглашению принят: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000a2.jpeg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06b', s = 'ok', 'jpeg принят: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000a3.png'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06c', s = 'ok', 'png принят: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000a4.webp'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06d', s = 'ok', 'webp принят: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000a5.avif'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06e', s = 'ok', 'avif принят: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'mixed-slug-123/3f2b9c1e-0000-4000-8000-0000000000a6.png'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06f', s = 'ok', 'slug с цифрами и дефисами принят: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('brand-logos', 'gds/3f2b9c1e-0000-4000-8000-0000000000b1.png'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06g', s = 'ok', 'логотип gds/<uuid>.png принят: ' || s);

  -- Недопустимые имена: все 42501.
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000c1.svg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06h', s = '42501', 'svg отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000c2.JPG'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06i', s = '42501', 'расширение в верхнем регистре отклонено: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'Altair/3f2b9c1e-0000-4000-8000-0000000000c3.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06j', s = '42501', 'папка с заглавной буквы отклонена: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', '3f2b9c1e-0000-4000-8000-0000000000c4.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06k', s = '42501', 'файл без папки отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/sub/3f2b9c1e-0000-4000-8000-0000000000c5.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06l', s = '42501', 'вложенная папка отклонена: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/not-a-uuid.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06m', s = '42501', 'имя не из uuid отклонено: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', '/altair/3f2b9c1e-0000-4000-8000-0000000000c6.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06n', s = '42501', 'путь с ведущим слешем отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', '../altair/3f2b9c1e-0000-4000-8000-0000000000c7.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06o', s = '42501', 'путь с .. отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000c8.jpg.exe'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06p', s = '42501', 'двойное расширение отклонено: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3F2B9C1E-0000-4000-8000-0000000000C9.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06q', s = '42501', 'uuid в верхнем регистре отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', E'altair/3f2b9c1e-0000-4000-8000-0000000000d1.jpg\n'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06r', s = '42501', 'имя с переводом строки в конце отклонено: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000d2.gif'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06s', s = '42501', 'gif отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-0000000000d3.html'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06t', s = '42501', 'html отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('product-images', 'alt_air/3f2b9c1e-0000-4000-8000-0000000000d4.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06u', s = '42501', 'папка с подчёркиванием отклонена: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('brand-logos', 'altair/3f2b9c1e-0000-4000-8000-0000000000d5.png'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06v', s = '42501', 'в brand-logos только папка gds: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('brand-logos', 'gds/3f2b9c1e-0000-4000-8000-0000000000d6.svg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06w', s = '42501', 'svg в brand-logos отклонён: ' || s);
  set local role authenticated;
  s := 'ok'; begin insert into storage.objects (bucket_id, name) values ('zz-private', 'altair/3f2b9c1e-0000-4000-8000-0000000000d7.jpg'); exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T06x', s = '42501', 'запись в посторонний бакет отклонена (наши политики его не касаются): ' || s);

  perform set_config('request.jwt.claims', '', true);
end $$;

-- T07: админ A: перезапись, переименование, удаление ----------------------------------------------
do $$
declare s text; v_rows int; v_name text;
begin
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

  -- upsert существующего файла: insert ... on conflict do update (нужны insert, select, update).
  set local role authenticated;
  s := 'ok'; begin
    insert into storage.objects (bucket_id, name) values ('product-images', 'altair/3f2b9c1e-0000-4000-8000-000000000001.jpg')
    on conflict (bucket_id, name) do update set updated_at = now();
  exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T07a', s = 'ok', 'upsert существующего файла разрешён админу: ' || s);

  -- переименование в допустимое имя.
  set local role authenticated;
  update storage.objects set name = 'altair/3f2b9c1e-0000-4000-8000-0000000000e1.jpg'
  where bucket_id = 'product-images' and name = 'altair/3f2b9c1e-0000-4000-8000-000000000001.jpg';
  get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T07b', v_rows = 1, 'переименование в допустимое имя: затронуто ' || v_rows);

  -- переименование в недопустимое имя.
  set local role authenticated;
  s := 'ok'; begin
    update storage.objects set name = 'altair/evil.svg'
    where bucket_id = 'product-images' and name = 'altair/3f2b9c1e-0000-4000-8000-0000000000e1.jpg';
  exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T07c', s = '42501', 'переименование в недопустимое имя отклонено: ' || s);

  -- перенос файла в посторонний бакет.
  set local role authenticated;
  s := 'ok'; begin
    update storage.objects set bucket_id = 'zz-private'
    where bucket_id = 'product-images' and name = 'altair/3f2b9c1e-0000-4000-8000-0000000000e1.jpg';
  exception when others then s := sqlstate; end;
  reset role; perform gds_test.check('T07d', s = '42501', 'перенос файла в посторонний бакет отклонён: ' || s);

  -- изменение чужого (постороннего) бакета.
  set local role authenticated;
  update storage.objects set name = 'secret/other.txt' where bucket_id = 'zz-private'; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T07e', v_rows = 0, 'файлы постороннего бакета админ менять не может: затронуто ' || v_rows);

  -- удаление.
  set local role authenticated;
  delete from storage.objects where bucket_id = 'product-images' and name = 'altair/3f2b9c1e-0000-4000-8000-0000000000e1.jpg'; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T07f', v_rows = 1, 'админ удаляет файл своего бакета: затронуто ' || v_rows);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'brand-logos' and name = 'gds/3f2b9c1e-0000-4000-8000-000000000002.png'; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T07g', v_rows = 1, 'админ удаляет логотип: затронуто ' || v_rows);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'zz-private'; get diagnostics v_rows = row_count;
  reset role; perform gds_test.check('T07h', v_rows = 0, 'файлы постороннего бакета админ удалить не может: затронуто ' || v_rows);

  select count(*) into v_rows from storage.objects where bucket_id = 'zz-private';
  perform gds_test.check('T07i', v_rows = 1, 'файл постороннего бакета цел');

  perform set_config('request.jwt.claims', '', true);
end $$;

rollback;

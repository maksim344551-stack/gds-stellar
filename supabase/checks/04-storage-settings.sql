-- check:04-storage-settings
do $$
declare
  n int;
  s text;
  v_listed int;
begin
  select count(*) into n
  from storage.buckets
  where id in ('product-images', 'brand-logos')
    and public and file_size_limit is not null and allowed_mime_types is not null;
  if n <> 2 then
    raise exception 'ПРОВАЛ: бакеты product-images и brand-logos должны быть публичными, с лимитом размера и списком типов (найдено подходящих: %)', n;
  end if;

  -- RLS на таблице файлов включён (иначе политики ниже ничего не защищают).
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'ПРОВАЛ: на storage.objects выключен RLS';
  end if;

  -- На таблице файлов ровно наши четыре политики, чужих нет (чужая политика могла
  -- бы открыть список файлов или загрузку).
  select count(*) into n
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname not in ('gds_storage_admin_read', 'gds_storage_admin_insert', 'gds_storage_admin_update', 'gds_storage_admin_delete');
  if n <> 0 then
    raise exception 'ПРОВАЛ: на storage.objects есть % посторонних политик (это открывает список файлов или запись); см. Storage -> Policies', n;
  end if;

  select count(*) into n
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('gds_storage_admin_read', 'gds_storage_admin_insert', 'gds_storage_admin_update', 'gds_storage_admin_delete');
  if n <> 4 then
    raise exception 'ПРОВАЛ: ожидалось 4 политики gds_storage_admin_*, найдено %', n;
  end if;

  -- Обычные пользователи не могут создавать свои бакеты.
  select count(*) into n
  from pg_policies
  where schemaname = 'storage' and tablename = 'buckets'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and roles && array['anon', 'public', 'authenticated']::name[];
  if n <> 0 then
    raise exception 'ПРОВАЛ: на storage.buckets есть % политик записи для anon, public или authenticated', n;
  end if;

  begin
    set local role anon;
    select count(*) into v_listed from storage.objects;
    s := 'ok';
    begin
      insert into storage.objects (bucket_id, name) values ('product-images', 'probe/3f2b9c1e-0000-4000-8000-0000000000aa.jpg');
    exception when others then s := sqlstate; end;
    reset role;
    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;
  if v_listed <> 0 then
    raise exception 'ПРОВАЛ: публичный ключ видит % файлов в списке (ожидалось 0)', v_listed;
  end if;
  if s = 'ok' then
    raise exception 'ПРОВАЛ: публичный ключ смог добавить запись о файле в storage.objects (ожидался отказ)';
  end if;
end
$$;

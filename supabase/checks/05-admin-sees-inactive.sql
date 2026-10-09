-- check:05-admin-sees-inactive
do $$
declare
  v_admin uuid;
  v_slug text;
  v_total int;
  v_seen int;
  v_hidden_seen int;
  v_flag boolean;
  v_probe uuid;
  v_rows int;
begin
  select id into v_admin from public.user_roles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'ПРОВАЛ: в user_roles нет админа. Сначала выполните Шаг 5 «Создать админа» из HUMAN_ACTIONS.md';
  end if;

  begin
    select slug into v_slug from public.products where is_active order by slug limit 1;
    if v_slug is null then
      raise exception 'ПРОВАЛ: нет активного вкуса для проверки';
    end if;
    update public.products set is_active = false where slug = v_slug;
    select count(*) into v_total from public.products;

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_seen from public.products;
    select count(*) into v_hidden_seen from public.products where slug = v_slug and is_active = false;
    select public.is_admin() into v_flag;

    -- админ может писать: вставка, изменение, удаление временной точки
    insert into public.stores (name, address, city, latitude, longitude, is_active)
    values ('PROBE', 'PROBE', 'PROBE', 1, 1, false) returning id into v_probe;
    update public.stores set city = 'PROBE 2' where id = v_probe;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'ПРОВАЛ: админ не смог изменить свою строку (затронуто %)', v_rows; end if;
    delete from public.stores where id = v_probe;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'ПРОВАЛ: админ не смог удалить свою строку (затронуто %)', v_rows; end if;
    reset role;

    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;

  if v_flag is distinct from true then
    raise exception 'ПРОВАЛ: is_admin() вернула % для админа (ожидалось true)', v_flag;
  end if;
  if v_seen <> v_total or v_hidden_seen <> 1 then
    raise exception 'ПРОВАЛ: админ видит % из % вкусов, скрытый вкус виден: % (ожидалось все и 1)', v_seen, v_total, v_hidden_seen;
  end if;
end
$$;

-- check:06-user-roles-privacy
do $$
declare
  s text;
  v_admin uuid;
  v_roles_total int;
  v_n int;
  v_only uuid;
begin
  select id into v_admin from public.user_roles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'ПРОВАЛ: в user_roles нет админа. Сначала выполните Шаг 5 «Создать админа» из HUMAN_ACTIONS.md';
  end if;
  select count(*) into v_roles_total from public.user_roles;

  begin
    -- anon
    set local role anon;
    s := 'ok'; begin perform count(*) from public.user_roles; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: anon читает user_roles (код %, ожидался отказ 42501)', s; end if;
    s := 'ok'; begin perform public.is_admin(); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: anon может вызвать is_admin() (код %, ожидался отказ 42501)', s; end if;
    reset role;

    -- обычный вошедший пользователь
    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.user_roles;
    reset role;
    if v_n <> 0 then raise exception 'ПРОВАЛ: обычный пользователь видит % строк user_roles (ожидалось 0)', v_n; end if;

    -- админ
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*), min(id::text)::uuid into v_n, v_only from public.user_roles;
    if v_n <> 1 or v_only <> v_admin then
      raise exception 'ПРОВАЛ: админ видит % строк user_roles вместо одной своей', v_n;
    end if;
    s := 'ok'; begin insert into public.user_roles (id, role) values (gen_random_uuid(), 'admin'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: админ смог выдать роль через REST (код %)', s; end if;
    s := 'ok'; begin update public.user_roles set role = 'admin' where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: админ смог изменить user_roles (код %)', s; end if;
    s := 'ok'; begin delete from public.user_roles where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: админ смог удалить из user_roles (код %)', s; end if;
    reset role;

    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;
end
$$;

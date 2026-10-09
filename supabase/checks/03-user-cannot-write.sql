-- check:03-user-cannot-write
do $$
declare
  s text;
  v_rows int;
  v_user uuid := gen_random_uuid();
  v_brand uuid;
  v_cat uuid;
  v_prod uuid;
begin
  select id into v_brand from public.brands order by created_at limit 1;
  select id into v_cat from public.categories order by created_at limit 1;
  select id into v_prod from public.products order by created_at limit 1;
  if v_brand is null or v_cat is null or v_prod is null then
    raise exception 'ПРОВАЛ: нет данных для проверки (выполнен ли 004_seed.sql?)';
  end if;

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    set local role authenticated;

    s := 'ok'; begin insert into public.brands (name, full_name, country) values ('PROBE', 'PROBE', 'PROBE'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: обычный пользователь: INSERT в brands дал % вместо 42501', s; end if;
    s := 'ok'; begin insert into public.categories (name, slug) values ('PROBE', 'probe'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: обычный пользователь: INSERT в categories дал % вместо 42501', s; end if;
    s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'PROBE', 'probe', 'L', 'D'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: обычный пользователь: INSERT в products дал % вместо 42501', s; end if;
    s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://example.test/probe.jpg'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: обычный пользователь: INSERT в product_images дал % вместо 42501', s; end if;
    s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('PROBE', 'A', 'C', 1, 1); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: обычный пользователь: INSERT в stores дал % вместо 42501', s; end if;

    update public.brands set name = 'PROBE' where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь изменил % строк в brands', v_rows; end if;
    update public.categories set name = 'PROBE' where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь изменил % строк в categories', v_rows; end if;
    update public.products set description = 'PROBE' where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь изменил % строк в products', v_rows; end if;
    update public.product_images set sort_order = 99 where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь изменил % строк в product_images', v_rows; end if;
    update public.stores set name = 'PROBE' where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь изменил % строк в stores', v_rows; end if;

    delete from public.product_images where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь удалил % строк из product_images', v_rows; end if;
    delete from public.products where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь удалил % строк из products', v_rows; end if;
    delete from public.stores where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь удалил % строк из stores', v_rows; end if;
    delete from public.brands where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь удалил % строк из brands', v_rows; end if;
    delete from public.categories where true; get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'ПРОВАЛ: обычный пользователь удалил % строк из categories', v_rows; end if;

    s := 'ok'; begin insert into public.user_roles (id, role) values (v_user, 'admin'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: обычный пользователь смог назначить себе роль (INSERT user_roles дал %)', s; end if;

    reset role;
    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;
end
$$;

-- check:02-anon-cannot-write
do $$
declare
  s text;
  v_before int;
  v_after int;
begin
  select (select count(*) from public.brands) + (select count(*) from public.categories)
       + (select count(*) from public.products) + (select count(*) from public.product_images)
       + (select count(*) from public.stores) + (select count(*) from public.user_roles)
  into v_before;

  begin
    set local role anon;

    s := 'ok'; begin insert into public.brands (name, full_name, country) values ('PROBE', 'PROBE', 'PROBE'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: INSERT в brands под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin update public.brands set name = 'PROBE' where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: UPDATE brands под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin delete from public.brands where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: DELETE brands под anon дал % вместо отказа 42501', s; end if;

    s := 'ok'; begin insert into public.categories (name, slug) values ('PROBE', 'probe'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: INSERT в categories под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin update public.categories set name = 'PROBE' where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: UPDATE categories под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin delete from public.categories where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: DELETE categories под anon дал % вместо отказа 42501', s; end if;

    s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description)
      select b.id, c.id, 'PROBE', 'probe', 'L', 'D' from public.brands b, public.categories c limit 1;
    exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: INSERT в products под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin update public.products set description = 'PROBE' where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: UPDATE products под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin delete from public.products where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: DELETE products под anon дал % вместо отказа 42501', s; end if;

    s := 'ok'; begin insert into public.product_images (product_id, image_url)
      select id, 'https://example.test/probe.jpg' from public.products limit 1;
    exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: INSERT в product_images под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin update public.product_images set sort_order = 99 where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: UPDATE product_images под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin delete from public.product_images where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: DELETE product_images под anon дал % вместо отказа 42501', s; end if;

    s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('PROBE', 'A', 'C', 1, 1); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: INSERT в stores под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin update public.stores set name = 'PROBE' where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: UPDATE stores под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin delete from public.stores where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: DELETE stores под anon дал % вместо отказа 42501', s; end if;

    s := 'ok'; begin insert into public.user_roles (id, role) values (gen_random_uuid(), 'admin'); exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: INSERT в user_roles под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin update public.user_roles set role = 'admin' where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: UPDATE user_roles под anon дал % вместо отказа 42501', s; end if;
    s := 'ok'; begin delete from public.user_roles where true; exception when others then s := sqlstate; end;
    if s <> '42501' then raise exception 'ПРОВАЛ: DELETE user_roles под anon дал % вместо отказа 42501', s; end if;

    reset role;
    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;

  select (select count(*) from public.brands) + (select count(*) from public.categories)
       + (select count(*) from public.products) + (select count(*) from public.product_images)
       + (select count(*) from public.stores) + (select count(*) from public.user_roles)
  into v_after;
  if v_after <> v_before then
    raise exception 'ПРОВАЛ: число строк изменилось с % на %', v_before, v_after;
  end if;
end
$$;

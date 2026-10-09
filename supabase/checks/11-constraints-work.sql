-- check:11-constraints-work
do $$
declare
  s text;
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
    s := 'ok'; begin insert into public.products (brand_id, category_id, name, slug, line, description) values (v_brand, v_cat, 'X', 'Bad Slug', 'L', 'D'); exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: slug с заглавной буквой и пробелом принят или дал код % (ожидался 23514)', s; end if;

    s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'javascript:alert(1)'); exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: ссылка javascript: принята или дала код % (ожидался 23514)', s; end if;
    s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'http://example.test/a.jpg'); exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: ссылка http принята или дала код % (ожидался 23514)', s; end if;

    s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('X', 'A', 'C', 91, 0); exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: широта 91 принята или дала код % (ожидался 23514)', s; end if;
    s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude) values ('X', 'A', 'C', 0, 181); exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: долгота 181 принята или дала код % (ожидался 23514)', s; end if;

    s := 'ok'; begin update public.products set weight_g = 0 where id = v_prod; exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: вес 0 принят или дал код % (ожидался 23514)', s; end if;
    s := 'ok'; begin update public.products set weight_g = 'NaN' where id = v_prod; exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: вес NaN принят или дал код % (ожидался 23514)', s; end if;

    s := 'ok'; begin insert into public.stores (name, address, city, latitude, longitude, email) values ('X', 'A', 'C', 0, 0, '"><svg/onload=alert(1)>@a.bc'); exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: e-mail с разметкой принят или дал код % (ожидался 23514)', s; end if;
    s := 'ok'; begin insert into public.product_images (product_id, image_url) values (v_prod, 'https://abc.supabase.co@evil.example/x.png'); exception when others then s := sqlstate; end;
    if s <> '23514' then raise exception 'ПРОВАЛ: ссылка с @ принята или дала код % (ожидался 23514)', s; end if;

    s := 'ok'; begin delete from public.brands where id = v_brand; exception when others then s := sqlstate; end;
    if s <> '23503' then raise exception 'ПРОВАЛ: бренд со вкусами удалён или дал код % (ожидался отказ 23503)', s; end if;

    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;
end
$$;

-- check:01-anon-reads-only-active
do $$
declare
  v_expected int;
  v_seen int;
  v_inactive_seen int;
  v_slug text;
begin
  -- Сколько вкусов публично видимы: активный вкус активного бренда.
  select count(*) into v_expected
  from public.products p
  join public.brands b on b.id = p.brand_id
  where p.is_active and b.is_active;
  if v_expected = 0 then
    raise exception 'ПРОВАЛ: в каталоге нет ни одного активного вкуса (выполнен ли 004_seed.sql?)';
  end if;

  begin
    -- Временно скрываем один вкус. Весь этот внутренний блок отменится сам.
    select p.slug into v_slug
    from public.products p join public.brands b on b.id = p.brand_id
    where p.is_active and b.is_active order by p.slug limit 1;
    update public.products set is_active = false where slug = v_slug;

    set local role anon;
    select count(*) into v_seen from public.products;
    select count(*) into v_inactive_seen from public.products where is_active = false;
    reset role;

    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;

  if v_inactive_seen <> 0 then
    raise exception 'ПРОВАЛ: публичный ключ видит % неактивных вкусов (ожидалось 0)', v_inactive_seen;
  end if;
  if v_seen <> v_expected - 1 then
    raise exception 'ПРОВАЛ: публичный ключ видит % вкусов, ожидалось % (все активные, кроме одного скрытого)', v_seen, v_expected - 1;
  end if;
end
$$;

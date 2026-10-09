-- check:08-hidden-brand-hides-flavors
do $$
declare
  v_products_before int;
  v_images_before int;
  v_products int;
  v_images int;
  v_brands int;
begin
  begin
    -- временная картинка у первого вкуса (отменится вместе со всем остальным)
    insert into public.product_images (product_id, image_url)
    select id, 'https://example.test/probe.jpg' from public.products order by slug limit 1;

    set local role anon;
    select count(*) into v_products_before from public.products;
    select count(*) into v_images_before from public.product_images;
    reset role;

    update public.brands set is_active = false where true;
    set local role anon;
    select count(*) into v_products from public.products;
    select count(*) into v_images from public.product_images;
    select count(*) into v_brands from public.brands;
    reset role;
    raise exception 'gds_rollback' using errcode = 'GD001';
  exception when sqlstate 'GD001' then
    null;
  end;
  if v_products_before = 0 or v_images_before = 0 then
    raise exception 'ПРОВАЛ: до скрытия бренда публичный ключ не видит ни вкусов (%), ни временной картинки (%): проверка невозможна', v_products_before, v_images_before;
  end if;
  if v_products <> 0 or v_images <> 0 or v_brands <> 0 then
    raise exception 'ПРОВАЛ: при скрытом бренде публичный ключ видит брендов %, вкусов %, картинок % (ожидалось 0, 0, 0)', v_brands, v_products, v_images;
  end if;
end
$$;

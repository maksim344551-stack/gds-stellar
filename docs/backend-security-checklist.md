# Чек-лист проверки безопасности бэкенда GDS (Supabase)

Версия 2026-10-08. Для владельца без технического опыта: каждый пункт можно проверить, скопировав готовый запрос.

## Как пользоваться

1. Откройте проект Supabase, слева **SQL Editor**, кнопка **New query**.
2. Скопируйте блок «SQL-проверка» целиком (от `do $$` до `$$;`), вставьте, нажмите **Run**.
3. Как читать результат:
   - зелёное сообщение **Success. No rows returned**: проверка пройдена;
   - красная ошибка, текст которой начинается со слова **ПРОВАЛ**: проверка не пройдена, текст говорит, что именно не так. Перешлите его разработчику;
   - любая другая красная ошибка (например, `permission denied` или `must be owner`): проверка не смогла выполниться, это тоже сообщите.
4. Все SQL-проверки безопасны для настоящих данных: каждая внутри себя временно что-то меняет (например, скрывает один вкус), смотрит результат и **сама отменяет** изменения. Ничего не сохраняется, даже если проверка упала.
5. Проверки 1, 2, 3, 5, 6, 8 имитируют вход под нужной ролью прямо в базе. Они не заменяют живой проверки через REST (кроме них даны команды `curl.exe`), но дают тот же результат по правам и политикам.
6. Редактор может показать окно «потенциально опасный запрос» (из-за слов `update`, `delete` внутри проверки). Для этих блоков это ожидаемо: нажмите **Run this query**, изменения всё равно отменяются самой проверкой.
7. Проверки 4 и 7 сверяют **полный набор** политик и бакетов. Если в проекте есть другие бакеты или таблицы с собственными публичными политиками, эти проверки покажут «ПРОВАЛ» из-за них: это ожидаемо для проекта, который используется не только под каталог GDS; решите это отдельно.

Что уже проверено мной на одноразовой базе PostgreSQL (не на Supabase): все SQL-блоки ниже выполнены на PostgreSQL 17.10 и 15.18, в двух режимах прав платформы (старом и новом), с заглушкой Supabase и дали «пройдено»; на намеренно испорченной защите они краснеют (список поломок: `supabase/tests/mutations.mjs`). Что НЕ проверялось (нет доступа к живому проекту): REST-команды из этого файла, публичные ссылки Storage, лимиты типов и размера файлов, настройки Auth в панели, Security Advisor, поведение SQL Editor (окна подтверждения, смена роли `postgres` на `anon`).

## Что нужно под рукой

- **Project URL** вида `https://<ref>.supabase.co` и **публичный ключ** (в ТЗ он назван anon key; у новых проектов он называется *publishable key*, начинается с `sb_publishable_`). Где взять: HUMAN_ACTIONS.md, Шаг 6 («Адрес и публичный ключ»).
- Для проверок 5 и 6 нужен созданный админ (HUMAN_ACTIONS.md, Шаг 5 «Создать админа»). Без него эти проверки скажут «ПРОВАЛ: в user_roles нет админа».
- Для команд `curl.exe` откройте **PowerShell**, **перейдите во временную папку** (чтобы пробные файлы с телом запроса не попали в папку проекта и в git) и задайте две переменные (подставьте свои значения; ключ `secret` или `service_role` сюда **никогда** не вставляйте):

```powershell
cd $env:TEMP
$URL = "https://<ref>.supabase.co"
$KEY = "<publishable key>"
```

Пробные файлы (`body.json`, `login.json`, `list.json`, `signup.json`) создаются в этой временной папке и удаляются командой `Remove-Item` сразу после запроса. Если команда прервалась, удалите файл вручную (`Remove-Item $env:TEMP\login.json`): в `login.json` лежит пароль.

## Сводка пунктов

| № | Что проверяем | Откуда пункт |
|---|---|---|
| 1 | Публичный ключ читает только `is_active = true` | ТЗ |
| 2 | Публичный ключ не может ни вставить, ни изменить, ни удалить ни в одной таблице | ТЗ |
| 3 | Вошедший обычный пользователь (не админ) не может писать в таблицы | ТЗ |
| 4 | Файлы из бакетов открываются по публичной ссылке; список файлов и загрузка для посторонних закрыты | ТЗ + мой пункт про список |
| 5 | Админ видит неактивные вкусы (`is_active = false`) | ТЗ |
| 6 | Роли: чужие роли не видны, выдать роль через REST нельзя | ТЗ (раздел RLS) |
| 7 | Сводка защиты: RLS включён, права минимальны, функция `is_admin` закрыта от публики | мой пункт |
| 8 | Скрытый бренд скрывает свои вкусы и картинки | мой пункт (расширение политик) |
| 9 | Настройки Auth: регистрация закрыта, анонимные входы выключены, ключ `secret` не в сайте | мой пункт |
| 10 | Security Advisor в панели Supabase | мой пункт |
| 11 | Ограничения значений срабатывают (slug, координаты, ссылки) | мой пункт |

---

## 1. Публичный ключ читает только `is_active = true`

**Что делает SQL-проверка.** Берёт один активный вкус, временно скрывает его, заходит под ролью `anon` (публичный ключ) и считает видимые вкусы: должны быть все активные, кроме скрытого, и ни одного неактивного.

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

**Проверка через REST (как с сайта).** Сначала в SQL Editor скройте один вкус: `update public.products set is_active = false where slug = 'altair';`. Потом:

```powershell
curl.exe -s "$URL/rest/v1/products?select=slug,is_active&order=slug" -H "apikey: $KEY"
```

Ожидается список из 9 вкусов без `altair`, у всех `"is_active":true`. После проверки верните вкус: `update public.products set is_active = true where slug = 'altair';`. (Эту REST-проверку я не запускал: у меня нет доступа к вашему проекту.)

---

## 2. Публичный ключ не может писать ни в одну таблицу

**Что делает SQL-проверка.** Под ролью `anon` пытается вставить, изменить и удалить строку в каждой из шести таблиц. Везде ожидается отказ по правам (код `42501`). Количество строк до и после сравнивается.

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

**Проверка через REST.** Создайте файл с телом запроса и отправьте его без входа (только публичный ключ):

```powershell
'{"name":"HACK","full_name":"HACK","country":"HACK"}' | Set-Content -Path body.json -Encoding ascii
curl.exe -i -s -X POST "$URL/rest/v1/brands" -H "apikey: $KEY" -H "Content-Type: application/json" --data-binary "@body.json"
curl.exe -i -s -X PATCH "$URL/rest/v1/brands?id=eq.00000000-0000-0000-0000-000000000000" -H "apikey: $KEY" -H "Content-Type: application/json" --data-binary "@body.json"
curl.exe -i -s -X DELETE "$URL/rest/v1/brands?id=eq.00000000-0000-0000-0000-000000000000" -H "apikey: $KEY"
Remove-Item body.json
```

Фильтр `id=eq.0000…` указывает на несуществующую строку: если защита вдруг сломана, `PATCH` и `DELETE` ничего не испортят. Первая команда (`POST`) при сломанной защите создала бы бренд с именем `HACK`: проверьте в Table Editor, что такой строки нет, а если есть, удалите её и сообщите разработчику.

Ожидается: во всех трёх ответах отказ (статус 401 или 403) и в теле `"code":"42501"`. Ни одной новой или изменённой строки в таблице `brands` после этого быть не должно. (Не запускалось на живом проекте.)

---

## 3. Вошедший обычный пользователь (не админ) не может писать

**Что делает SQL-проверка.** Имитирует вошедшего пользователя со случайным идентификатором (его нет в `user_roles`, значит он не админ). Вставка должна быть отклонена политикой (код `42501`), изменение и удаление не должны затронуть ни одной строки, а выдать себе роль админа нельзя.

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

**Проверка через REST (по-настоящему).** Нужен второй пользователь, не админ: в панели **Authentication → Users → Add user → Create new user**, отметьте «Auto Confirm User», задайте почту и пароль (эти данные нигде не сохраняйте). Войдите им. Пароль вводится в окне, поэтому не попадает ни в историю команд PowerShell, ни в файл:

```powershell
# выполняйте в PowerShell во временной папке (cd $env:TEMP)
$cred = Get-Credential -Message "Почта и пароль ОБЫЧНОГО пользователя (не админа)"
$login = @{ email = $cred.UserName; password = $cred.GetNetworkCredential().Password } | ConvertTo-Json
$resp = Invoke-RestMethod -Method Post -Uri "$URL/auth/v1/token?grant_type=password" -Headers @{ apikey = $KEY } -ContentType "application/json" -Body $login
$TOKEN = $resp.access_token
Remove-Variable login, cred, resp
```

Запись: вставка бренда должна быть отклонена. Изменение проверяется безобидным запросом к **настоящей** строке: ставим значение, которое у неё уже есть (`is_active = true`), так что данные не меняются в любом случае.

```powershell
'{"name":"HACK","full_name":"HACK","country":"HACK"}' | Set-Content -Path body.json -Encoding ascii
curl.exe -i -s -X POST "$URL/rest/v1/brands" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary "@body.json"
Remove-Item body.json
$brandId = (Invoke-RestMethod -Uri "$URL/rest/v1/brands?select=id&limit=1" -Headers @{ apikey = $KEY })[0].id
'{"is_active":true}' | Set-Content -Path patch.json -Encoding ascii
curl.exe -s -X PATCH "$URL/rest/v1/brands?id=eq.$brandId" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Prefer: return=representation" --data-binary "@patch.json"
Remove-Item patch.json
```

Если защита вдруг сломана, `POST` создаст бренд `HACK` (проверьте в Table Editor, что его нет, иначе удалите и сообщите разработчику), а `PATCH` вернёт строку (но данные при этом не изменятся).

Ожидается: `POST` отклонён (`42501`, «row-level security»), `PATCH` возвращает пустой список `[]` (политика не пропускает изменение). Затем удалите пробного пользователя в панели. (Не запускалось на живом проекте.)

---

## 4. Файлы открываются по публичной ссылке; список файлов и загрузка закрыты

Что должно быть. Бакеты `product-images` и `brand-logos` публичные: любой файл открывается по прямой ссылке без входа. При этом **посторонний не может получить список файлов** (иначе виден и ещё не опубликованный материал), не может загрузить, заменить или удалить файл.

**SQL-проверка (настройки в базе).** Проверяет, что бакеты публичные и имеют лимиты, что на таблице файлов включён RLS и стоят ровно наши четыре политики (чужих нет), что обычные пользователи не могут создавать бакеты, что `anon` не видит файлов и не может добавить запись о файле.

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

**Ручная проверка публичной ссылки (обязательная, SQL её не заменяет).**

1. В панели: **Storage → product-images**, создайте папку `altair`, зайдите в неё и нажмите **Upload file**. Загрузите любую небольшую картинку (PNG или JPG), назвав файл по правилу `3f2b9c1e-0000-4000-8000-000000000001.png` (по моим сведениям, панель загружает от имени владельца и правило имён не проверяет; на живом проекте это не проверялось. Так вы увидите ту же картину, что будет у админки).
2. Нажмите на загруженный файл, **Get URL** (или **Copy URL**) и откройте ссылку в новой вкладке браузера, где вы не вошли в Supabase. Ожидается: картинка открывается.
3. Командой: `curl.exe -I "<скопированная ссылка>"`. Ожидается: первая строка `HTTP/1.1 200` или `HTTP/2 200`, в заголовках `content-type: image/png`.
4. Проверка закрытого списка (публичный ключ не должен показывать файлы). Ожидается пустой список `[]` или отказ:

```powershell
'{"prefix":"","limit":10}' | Set-Content -Path list.json -Encoding ascii
curl.exe -s -X POST "$URL/storage/v1/object/list/product-images" -H "apikey: $KEY" -H "Content-Type: application/json" --data-binary "@list.json"
Remove-Item list.json
```

5. Проверка запрета загрузки публичным ключом. Ожидается ошибка со словами `row-level security` и файл не появляется:

```powershell
curl.exe -s -X POST "$URL/storage/v1/object/product-images/altair/3f2b9c1e-0000-4000-8000-0000000000bb.png" -H "apikey: $KEY" -H "Content-Type: image/png" --data-binary "@<путь к любой маленькой картинке>"
```

6. Проверка лимитов: загрузите через панель в `brand-logos` файл больше 2 МБ или любой не-картинку. Ожидается отказ Storage (лимит размера и список типов заданы в 003_storage.sql).
7. Удалите тестовые файлы (в панели: выбрать файл, **Delete**).

(Пункты 1-7 не запускались на живом проекте.)

---

## 5. Админ видит неактивные вкусы

**Что делает SQL-проверка.** Берёт первого админа из `user_roles`, временно скрывает один вкус и заходит под этим админом: он должен видеть все вкусы, включая скрытый, `is_admin()` должна вернуть `true`. Заодно убеждается, что админ **может писать**: вставляет, меняет и удаляет временную точку продаж (она в любом случае отменяется).

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

**Проверка через REST (по-настоящему).** Войдите админом так же, как в пункте 3 (команды с `Get-Credential`, но с почтой и паролем админа), получите `$TOKEN`. В SQL Editor скройте вкус: `update public.products set is_active = false where slug = 'altair';`.

```powershell
$TOKEN = "<access_token админа>"
curl.exe -s "$URL/rest/v1/products?select=slug,is_active&is_active=eq.false" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
curl.exe -s "$URL/rest/v1/products?select=slug,is_active&is_active=eq.false" -H "apikey: $KEY"
```

Ожидается: первая команда показывает вкус `altair` с `"is_active":false`, вторая (без входа) показывает пустой список `[]`. Затем верните: `update public.products set is_active = true where slug = 'altair';`. Вызов функции от админа: `curl.exe -s -X POST "$URL/rest/v1/rpc/is_admin" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{}"` должен вернуть `true`. (Не запускалось на живом проекте.)

---

## 6. Роли: чужие не видны, выдать роль через REST нельзя

**Что делает SQL-проверка.** Под `anon` таблица `user_roles` недоступна и функцию `is_admin()` вызвать нельзя. Обычный пользователь видит 0 строк. Админ видит только свою строку (даже если админов несколько). Админ не может выдать роль через REST.

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

---

## 7. Сводка защиты (можно запускать в любое время)

**Что делает.** Проверяет итоговое состояние: RLS включён на шести таблицах, у `anon` нет прав записи (в том числе на отдельные колонки), у `authenticated` нет служебных прав и записи в `user_roles`, `is_admin()` закрыта от публики и работает с фиксированным `search_path`, **на таблицах каталога стоят ровно наши 25 политик и больше никаких** (чужая политика, например созданная по шаблону из панели «Enable read access for all users», открыла бы скрытые строки), представлений нет. Запускайте после любых ручных правок в панели (особенно в **Authentication → Policies** и **Database → Tables**). Если вы позже сами добавите политику новой миграцией, внесите её имя в список `v_expected` ниже.

```sql
-- check:07-protection-summary
do $$
declare
  v_tables text[] := array['brands', 'categories', 'products', 'product_images', 'stores', 'user_roles'];
  v_expected text[] := array[
    'brands.brands_public_read', 'brands.brands_admin_read_all', 'brands.brands_admin_insert',
    'brands.brands_admin_update', 'brands.brands_admin_delete',
    'categories.categories_public_read', 'categories.categories_admin_insert',
    'categories.categories_admin_update', 'categories.categories_admin_delete',
    'products.products_public_read', 'products.products_admin_read_all', 'products.products_admin_insert',
    'products.products_admin_update', 'products.products_admin_delete',
    'product_images.product_images_public_read', 'product_images.product_images_admin_read_all',
    'product_images.product_images_admin_insert', 'product_images.product_images_admin_update',
    'product_images.product_images_admin_delete',
    'stores.stores_public_read', 'stores.stores_admin_read_all', 'stores.stores_admin_insert',
    'stores.stores_admin_update', 'stores.stores_admin_delete',
    'user_roles.user_roles_read_own'
  ];
  v_table text;
  v_priv text;
  v_n int;
  v_cfg text[];
  v_list text;
begin
  foreach v_table in array v_tables loop
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = v_table) then
      raise exception 'ПРОВАЛ: RLS выключен на public.%', v_table;
    end if;
    foreach v_priv in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege('anon', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'ПРОВАЛ: у anon есть право % на public.% (или на её колонку)', v_priv, v_table;
      end if;
    end loop;
    foreach v_priv in array array['DELETE', 'TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('anon', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'ПРОВАЛ: у anon есть право % на public.%', v_priv, v_table;
      end if;
    end loop;
    if has_any_column_privilege('authenticated', format('public.%I', v_table)::regclass, 'REFERENCES') then
      raise exception 'ПРОВАЛ: у authenticated есть право REFERENCES на public.% (или на её колонку)', v_table;
    end if;
    foreach v_priv in array array['TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('authenticated', format('public.%I', v_table)::regclass, v_priv) then
        raise exception 'ПРОВАЛ: у authenticated есть право % на public.%', v_priv, v_table;
      end if;
    end loop;
  end loop;

  if has_any_column_privilege('anon', 'public.user_roles'::regclass, 'SELECT') then
    raise exception 'ПРОВАЛ: anon может читать public.user_roles (или её колонку)';
  end if;
  foreach v_priv in array array['INSERT', 'UPDATE'] loop
    if has_any_column_privilege('authenticated', 'public.user_roles'::regclass, v_priv) then
      raise exception 'ПРОВАЛ: у authenticated есть право % на public.user_roles (или на её колонку)', v_priv;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.user_roles'::regclass, 'DELETE') then
    raise exception 'ПРОВАЛ: у authenticated есть право DELETE на public.user_roles';
  end if;

  if has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') then
    raise exception 'ПРОВАЛ: anon может вызывать public.is_admin()';
  end if;
  select count(*) into v_n
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = 'public.is_admin()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: PUBLIC может вызывать public.is_admin()';
  end if;
  select proconfig into v_cfg from pg_proc where oid = 'public.is_admin()'::regprocedure;
  if not (select prosecdef from pg_proc where oid = 'public.is_admin()'::regprocedure)
     or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception 'ПРОВАЛ: public.is_admin() должна быть SECURITY DEFINER с пустым search_path (сейчас: %)', coalesce(array_to_string(v_cfg, ','), 'нет настроек');
  end if;

  -- Политики на таблицах каталога: ровно наши, без чужих и ничего не пропало.
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into v_list
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = any (v_tables)
    and not ((p.tablename || '.' || p.policyname) = any (v_expected));
  if v_list is not null then
    raise exception 'ПРОВАЛ: на таблицах каталога есть посторонние политики: %', v_list;
  end if;
  select string_agg(e, ', ' order by e) into v_list
  from unnest(v_expected) as e
  where not exists (select 1 from pg_policies p where p.schemaname = 'public' and (p.tablename || '.' || p.policyname) = e);
  if v_list is not null then
    raise exception 'ПРОВАЛ: пропали политики: %', v_list;
  end if;

  select count(*) into v_n from pg_views where schemaname = 'public';
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: в схеме public есть % представлений (view); они по умолчанию обходят RLS', v_n;
  end if;

  select count(*) into v_n from pg_tables where schemaname = 'public' and not rowsecurity;
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: в схеме public есть % таблиц без RLS', v_n;
  end if;
end
$$;
```

**Ожидаемый результат:** `Success. No rows returned`.

---

## 8. Скрытый бренд скрывает свои вкусы и картинки

**Что делает.** Добавляет временную картинку, убеждается, что при активном бренде публичный ключ её видит, затем временно скрывает бренд и убеждается, что публичный ключ перестал видеть и бренд, и его вкусы, и их картинки.

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

Практический смысл: чтобы быстро убрать весь каталог с сайта, достаточно одного запроса (он есть в `docs/runbook.md`).

**Важно: это скрывает только строки API, а не файлы.** Картинки в публичных бакетах продолжают открываться по прямым ссылкам, пока файлы не удалены (и ещё какое-то время из кэша CDN: срок я не проверял). Если нужно убрать и файлы, см. `docs/runbook.md`, раздел 1.

---

## 9. Настройки Auth (в панели, SQL тут не поможет)

Проверьте руками в **Authentication** (названия пунктов могут чуть отличаться: интерфейс Supabase меняется):

| Что проверить | Ожидается | Зачем |
|---|---|---|
| Sign In / Providers → «Allow new users to sign up» | **выключено** | никто посторонний не может зарегистрироваться; админ создаётся вами вручную |
| Sign In / Providers → «Allow anonymous sign-ins» | **выключено** | анонимные «пользователи» тоже получают роль `authenticated` |
| Sign In / Providers → Email → «Confirm email» | выключено (так просит ТЗ) | см. HUMAN_ACTIONS.md: письма пока не настроены |
| Sign In / Providers → Email → минимальная длина пароля | 12 или больше | пароль админа не должен быть коротким |
| Authentication → Users | только вы (и нужные админы), без незнакомых адресов | проверка, что регистрация не была открыта раньше |

Необязательная проверка, что регистрация закрыта (**если она на самом деле открыта, команда создаст пробного пользователя**, удалите его потом в Authentication → Users). Ожидается отказ вида «Signups not allowed» / `signup_disabled`:

```powershell
'{"email":"probe-signup@example.com","password":"Probe-Password-12345"}' | Set-Content -Path signup.json -Encoding ascii
curl.exe -i -s -X POST "$URL/auth/v1/signup" -H "apikey: $KEY" -H "Content-Type: application/json" --data-binary "@signup.json"
Remove-Item signup.json
```

**Ключ `secret` (или старый `service_role`) не должен попасть на сайт.** После сборки сайта (папка `dist`) выполните в папке проекта:

```powershell
Get-ChildItem dist -Recurse -File | Select-String -Pattern "sb_secret_" -List
# Старый секретный ключ service_role это JWT: слово service_role в нём спрятано в кодировке base64,
# обычный поиск его не найдёт. Находим все JWT-подобные строки и показываем их содержимое:
Get-ChildItem dist -Recurse -File | Select-String -Pattern "eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}" -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object {
  $p = $_.Groups[1].Value -replace '-', '+' -replace '_', '/'
  $p = $p.PadRight($p.Length + (4 - $p.Length % 4) % 4, '=')
  try { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) } catch { 'не удалось разобрать' }
}
```

(`Select-String` сам по папкам не ходит, поэтому файлы сначала перечисляет `Get-ChildItem -Recurse`.) Ожидается: первая команда ничего не выводит; вторая либо ничего, либо строки вида `{"iss":"supabase",...,"role":"anon"}`. Роль `anon` допустима (это публичный ключ в старом формате). **Если видите `"role":"service_role"`, секретный ключ попал в сборку.** (Команда проверена мной на искусственных ключах в временной папке.) Если что-то нашлось, ключ считается утёкшим: замените его (HUMAN_ACTIONS.md, `docs/runbook.md`). (Эту проверку на вашем сайте я не выполнял: сайт сейчас не подключён к Supabase.)

---

## 10. Security Advisor (встроенный сканер Supabase)

В панели: **Advisors → Security Advisor** (в старых версиях интерфейса: **Database → Linter**). Нажмите **Rerun** или откройте список.

Ожидается: **ни одной ошибки (ERROR)**. Предупреждения (WARN), которые я ожидаю и которые допустимы (проверить по факту не мог):

- «Signed-In Users Can Execute SECURITY DEFINER Function» про `public.is_admin`: сознательно, ТЗ требует эту функцию в схеме `public`; она возвращает только статус самого вызывающего, у `anon` права на неё нет.
- «Multiple Permissive Policies» (предупреждение о скорости, не о безопасности) для `brands`, `products`, `product_images`, `stores`: две политики чтения для вошедших (публичная и «админ видит всё») заданы ТЗ; на объёме каталога влияния нет.

- Возможно: «Leaked Password Protection Disabled» (защита от паролей из известных утечек; по документации Supabase доступна на платных тарифах). Это не ошибка конфигурации базы; решение владельца (HUMAN_ACTIONS.md, Шаг 2). Точной формулировки предупреждений я не знаю, поэтому ориентируйтесь на смысл.

Всё остальное (RLS отключён, функция без `search_path`, публичный бакет со списком файлов, таблица без политик) должно отсутствовать. Если сканер что-то находит из этого списка, перешлите текст разработчику.

---

## 11. Ограничения значений срабатывают

**Что делает.** Пробует записать заведомо плохие значения и убеждается, что база их отклоняет.

```sql
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
```

**Ожидаемый результат:** `Success. No rows returned`.

---

## Если что-то пошло не так

- Проверка 7 или 2 упала: не вносите правки руками. Напишите разработчику текст ошибки. Быстрая мера: Table Editor → таблица → **Enable RLS**, а в SQL Editor повторите `002_rls.sql` (он безопасен для повтора и снова отзовёт лишние права).
- Проверка 4 упала про «политики для anon»: откройте **Storage → Policies** и удалите политики, которые дают доступ публичной роли, затем повторите `003_storage.sql`. Осторожно: повтор `003_storage.sql` возвращает бакетам `public = true`, то есть снова открывает ссылки на файлы, если вы закрывали бакеты аварийно (`docs/runbook.md`, раздел 1).
- Краткий порядок срочных действий при подозрении на взлом: `docs/runbook.md`.

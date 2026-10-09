// supabase/tests/mutations.mjs
// Мутационная проверка тестов: защиту ломают НАРОЧНО и убеждаются, что хотя бы один
// тест (или SQL-блок чек-листа) краснеет. Зелёный прогон без этой проверки ничего не
// доказывает: тесты могли бы быть «пустыми».
//
// Каждая поломка применяется к своей свежей одноразовой базе (gds_mut<N>_test) после
// штатных миграций, потом запускаются SQL-тесты и блоки чек-листа БЕЗ повторного
// применения миграций (повторный запуск файла нередко сам чинит поломку). Отдельно
// проверяется чистая база: на ней должно быть 0 провалов.
//
// Запуск (пакеты ставятся вне проекта, см. sandbox-embedded.mjs):
//   GDS_SANDBOX_PREFIX=<папка> node supabase/tests/mutations.mjs [--locale="..."]
// Код выхода: 0 все поломки обнаружены; 1 есть необнаруженные; 2 сбой запуска.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSandbox } from './lib/sandbox.mjs';
import { Suite, assertDisposableTarget, loadPg, migrationFiles } from './run.mjs';

const prefix = process.env.GDS_SANDBOX_PREFIX;
if (!prefix) {
  console.error('Не задан GDS_SANDBOX_PREFIX (см. sandbox-embedded.mjs).');
  process.exit(2);
}
const localeArg = process.argv.slice(2).find((a) => a.startsWith('--locale='));
const locale = localeArg ? localeArg.slice('--locale='.length) : 'C';

// [название, SQL поломки]
export const MUTATIONS = [
  ['M01 anon получил INSERT на products', 'grant insert on public.products to anon'],
  ['M02 лишняя публичная политика чтения products', 'create policy zz_leak on public.products for select to anon using (true)'],
  ['M03 удалена политика вставки products', 'drop policy products_admin_insert on public.products'],
  ['M04 is_admin стала SECURITY INVOKER', 'alter function public.is_admin() security invoker'],
  ['M05 у is_admin сброшен search_path', 'alter function public.is_admin() reset search_path'],
  ['M06 право вызова is_admin выдано anon', 'grant execute on function public.is_admin() to anon'],
  ['M07 публичная политика чтения storage.objects', "create policy zz_storage_leak on storage.objects for select to anon using (bucket_id = 'product-images')"],
  ['M08 authenticated получил TRUNCATE на brands', 'grant truncate on public.brands to authenticated'],
  ['M09 вставка в brands разрешена любому вошедшему', 'create policy zz_insert on public.brands for insert to authenticated with check (true)'],
  ['M10 RLS выключен на stores', 'alter table public.stores disable row level security'],
  ['M11 бакет product-images стал приватным', "update storage.buckets set public = false where id = 'product-images'"],
  ['M12 удалено ограничение slug у products', 'alter table public.products drop constraint products_slug_format'],
  ['M13 ослаблена видимость products (без проверки бренда)',
    'drop policy products_public_read on public.products; create policy products_public_read on public.products for select to anon, authenticated using (is_active)'],
  ['M14 anon получил SELECT на user_roles', 'grant select on public.user_roles to anon'],
  ['M15 вошедший может писать в user_roles',
    'grant insert on public.user_roles to authenticated; create policy zz_roles_ins on public.user_roles for insert to authenticated with check (true)'],
  ['M16 is_admin всегда true',
    "create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select true $$"],
  ['M17 политика записи storage для anon', "create policy zz_storage_ins on storage.objects for insert to anon with check (bucket_id = 'product-images')"],
  ['M18 каскад вместо restrict у brand_id',
    'alter table public.products drop constraint products_brand_id_fkey; ' +
    'alter table public.products add constraint products_brand_id_fkey foreign key (brand_id) references public.brands (id) on delete cascade'],
  ['M19 убрана проверка пути в политике вставки storage',
    "drop policy gds_storage_admin_insert on storage.objects; create policy gds_storage_admin_insert on storage.objects for insert to authenticated with check ((select public.is_admin()) and bucket_id in ('product-images','brand-logos'))"],
  ['M20 у product_images видимость без проверки родителя',
    'drop policy product_images_public_read on public.product_images; create policy product_images_public_read on public.product_images for select to anon, authenticated using (true)'],
  ['M21 anon может обновлять stores', 'grant update on public.stores to anon; create policy zz_stores_upd on public.stores for update to anon using (true) with check (true)'],
  ['M22 триггер updated_at удалён', 'drop trigger products_set_updated_at on public.products'],
  ['M23 pgcrypto переехал в public', 'drop extension pgcrypto; create extension pgcrypto with schema public'],
  // Поломки под защиты, добавленные после независимого ревью.
  ['M24 вес принимает NaN (удалено ограничение products_weight_range)', 'alter table public.products drop constraint products_weight_range'],
  ['M25 e-mail без проверки символов',
    'alter table public.stores drop constraint stores_email_format; alter table public.stores add constraint stores_email_format check (email is null or email like \'%@%\')'],
  ['M26 ссылка на картинку допускает @ и скобки',
    "alter table public.product_images drop constraint product_images_url_https; alter table public.product_images add constraint product_images_url_https check (image_url like 'https://%')"],
  ['M27 чужая публичная политика чтения на brands (скрытые бренды открыты)', 'create policy zz_broad on public.brands for select to public using (true)'],
  ['M28 RLS выключен на storage.objects', 'alter table storage.objects disable row level security'],
  ['M29 чужая политика загрузки для вошедших на storage.objects',
    "create policy zz_auth_ins on storage.objects for insert to authenticated with check (bucket_id = 'product-images')"],
  ['M30 право INSERT на колонку у anon', 'grant insert (name) on public.brands to anon'],
  ['M31 право SELECT на колонку user_roles у anon', 'grant select (id) on public.user_roles to anon'],
  ['M32 вошедшие могут создавать бакеты', 'create policy zz_bk on storage.buckets for insert to authenticated with check (true)'],
  ['M33 права сняты целиком (как делал старый повторный 001)',
    'revoke all on table public.brands, public.categories, public.products, public.product_images, public.stores, public.user_roles from anon, authenticated'],
  ['M34 порядок вкусов потерян (одинаковый created_at)',
    'alter table public.products disable trigger products_set_updated_at; update public.products set created_at = now(); ' +
    'alter table public.products enable trigger products_set_updated_at'],
  ['M35 право TRUNCATE у anon', 'grant truncate on public.products to anon'],
  ['M36 удалено ограничение названия бренда (пустые и пробельные имена)',
    'alter table public.brands drop constraint brands_name_len'],
];

// Поломки ИСХОДНИКОВ миграций: в копии файла правится текст, потом проверяется, что
// покраснели тесты «окна» между 001 и 002, тест повтора одного 001, тесты сида и
// ограничений или что самопроверка миграции перестала останавливать файл.
// kind:
//   window  применяется испорченный 001, затем тесты окна (sql/window);
//   rerun   сначала штатные миграции, затем испорченный 001 повторно и тесты;
//   tests   вместо штатного файла применяется испорченный, затем все тесты;
//   abort   штатные миграции, затем испорченный файл должен был остановиться при испорченном
//           состоянии (abort), а он НЕ останавливается: это и есть обнаружение.
const SOURCE_MUTATIONS = [
  { title: 'S01 в 001 не включён RLS у products (окно между 001 и 002 открыто)', prefix: '001', kind: 'window',
    from: 'alter table public.products       enable row level security;', to: '' },
  { title: 'S02 в 001 безусловный revoke all (повтор 001 снимает права, выданные 002)', prefix: '001', kind: 'rerun',
    from: 'revoke truncate, references, trigger on table', to: 'revoke all on table' },
  { title: 'S03 в 001 не отзывается TRUNCATE', prefix: '001', kind: 'window',
    from: 'revoke truncate, references, trigger on table', to: 'revoke references, trigger on table' },
  { title: 'S04 в 001 телефон без проверки цифры', prefix: '001', kind: 'tests',
    from: " and phone ~ '[0-9]'", to: '' },
  { title: 'S05 в 004 не задан порядок вкусов', prefix: '004', kind: 'tests',
    from: "now() + v.n * interval '1 millisecond'", to: 'now()' },
  { title: 'S06 в 002 самопроверка не сверяет список политик', prefix: '002', kind: 'abort',
    from: 'if v_unexpected is not null then', to: 'if false then', includes: 'GDS 002',
    setup: 'create policy zz_broad on public.brands for select to public using (true)',
    cleanup: 'drop policy if exists zz_broad on public.brands' },
  { title: 'S07 в 003 самопроверка не проверяет RLS на storage.objects', prefix: '003', kind: 'abort',
    from: 'if not (select c.relrowsecurity', to: 'if false and not (select c.relrowsecurity', includes: 'GDS 003',
    setup: 'alter table storage.objects disable row level security',
    cleanup: 'alter table storage.objects enable row level security' },
  { title: 'S08 в 003 самопроверка не сверяет список политик Storage', prefix: '003', kind: 'abort',
    from: 'if v_unexpected is not null then', to: 'if false then', includes: 'GDS 003',
    setup: "create policy zz_pub on storage.objects for select to anon using (bucket_id = 'product-images')",
    cleanup: 'drop policy if exists zz_pub on storage.objects' },
];

function replaceOnce(text, from, to) {
  const i = text.indexOf(from);
  if (i < 0) throw new Error(`в исходнике не найден фрагмент для поломки: ${from.slice(0, 50)}`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

async function main() {
  let sandbox;
  let undetected = 0;
  let total = 0;
  try {
    sandbox = await startSandbox({ prefix, locale });
    const { Client } = loadPg();
    console.log(`PostgreSQL ${sandbox.serverVersion}, локаль «${sandbox.locale}»`);

    const runOn = async (n, mutationSql) => {
      const dbName = `gds_mut${n}_test`;
      await sandbox.createDatabase(dbName);
      const connectionString = sandbox.urlFor(dbName);
      assertDisposableTarget(connectionString);
      const client = new Client({ connectionString });
      await client.connect();
      try {
        const suite = new Suite(client);
        suite.round = 1;
        await suite.prepare('legacy');
        await suite.applyMigrations();
        if (mutationSql) await client.query(mutationSql);
        suite.results.length = 0;
        await suite.runTests();
        const tests = suite.summary();
        suite.results.length = 0;
        await suite.runDocChecks();
        const docs = suite.summary();
        return { tests, docs };
      } finally {
        await client.end();
      }
    };

    // Чистая база: провалов быть не должно.
    const clean = await runOn(0, null);
    const cleanOk = clean.tests.fail === 0 && clean.docs.fail === 0 && clean.tests.pass > 0;
    console.log(`Чистая база: тесты прошло ${clean.tests.pass}, провалов ${clean.tests.fail}; чек-лист прошло ${clean.docs.pass}, провалов ${clean.docs.fail}`);
    if (!cleanOk) {
      console.log('ИТОГО: на чистой базе есть провалы, мутации не запускались');
      return 1;
    }

    let n = 0;
    for (const [title, sql] of MUTATIONS) {
      n += 1;
      total += 1;
      const { tests, docs } = await runOn(n, sql);
      const ids = tests.failed.map((r) => r.id);
      const shown = ids.slice(0, 5).join(', ') + (ids.length > 5 ? ` ...(+${ids.length - 5})` : '');
      const docIds = docs.failed.map((r) => r.id.replace('DOC:', '')).join(', ');
      const detected = tests.fail > 0 || docs.fail > 0;
      if (!detected) undetected += 1;
      console.log(`${title}: ${detected ? 'ОБНАРУЖЕНО' : 'НЕ ОБНАРУЖЕНО'}; тесты красные: ${tests.fail} (${shown}); чек-лист красный: ${docs.fail} (${docIds})`);
    }
    // Поломки исходников миграций.
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'gds-mut-src-'));
    try {
      for (const mut of SOURCE_MUTATIONS) {
        n += 1;
        total += 1;
        const files = migrationFiles();
        const original = files.find((f) => path.basename(f).startsWith(`${mut.prefix}_`));
        const mutatedPath = path.join(tmpDir, path.basename(original));
        writeFileSync(mutatedPath, replaceOnce(readFileSync(original, 'utf8'), mut.from, mut.to), 'utf8');

        const dbName = `gds_mut${n}_test`;
        await sandbox.createDatabase(dbName);
        const connectionString = sandbox.urlFor(dbName);
        assertDisposableTarget(connectionString);
        const client = new Client({ connectionString });
        await client.connect();
        let failedIds = [];
        try {
          const suite = new Suite(client);
          suite.round = 1;
          await suite.prepare('legacy');
          const [first, ...rest] = files;
          const useMutated = (f) => (f === original ? mutatedPath : f);
          if (mut.kind === 'window') {
            await suite.applyMigrations([useMutated(first)]);
            suite.results.length = 0;
            await suite.runWindowTests();
          } else if (mut.kind === 'rerun') {
            await suite.applyMigrations();
            await suite.applyMigrations([mutatedPath]);
            suite.results.length = 0;
            await suite.runTests();
          } else if (mut.kind === 'tests') {
            await suite.applyMigrations(files.map(useMutated));
            suite.results.length = 0;
            await suite.runTests();
          } else {
            await suite.applyMigrations(files);
            suite.results.length = 0;
            await suite.expectAbort({
              id: 'MUT', desc: mut.title, setup: mut.setup, file: mutatedPath,
              includes: mut.includes, cleanup: mut.cleanup,
            });
            // в этом режиме красный MUT (файл не остановился) означает «поломка обнаружена»
          }
          failedIds = suite.results.filter((r) => r.status !== 'PASS').map((r) => r.id);
        } finally {
          await client.end();
        }
        const detected = failedIds.length > 0;
        if (!detected) undetected += 1;
        const shown = failedIds.slice(0, 5).join(', ') + (failedIds.length > 5 ? ` ...(+${failedIds.length - 5})` : '');
        console.log(`${mut.title}: ${detected ? 'ОБНАРУЖЕНО' : 'НЕ ОБНАРУЖЕНО'}; красные проверки: ${failedIds.length} (${shown})`);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log(undetected === 0
      ? `ИТОГО: все ${total} поломок обнаружены`
      : `ИТОГО: из ${total} поломок необнаружено ${undetected}`);
    return undetected === 0 ? 0 : 1;
  } catch (err) {
    console.error('Сбой запуска мутаций:', String(err?.message ?? err).split('\n')[0]);
    return 2;
  } finally {
    if (sandbox) await sandbox.stop();
  }
}

process.exit(await main());

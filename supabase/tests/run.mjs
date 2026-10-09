// supabase/tests/run.mjs
// Прогон миграций и SQL-тестов на ОДНОРАЗОВОЙ базе PostgreSQL с заглушкой Supabase.
//
// ЭТО НЕ ДЛЯ БОЕВОЙ БАЗЫ. Скрипт сам отказывается работать, если база не
// локальная или в её имени нет отдельным словом (через _ или -) test, dev, tmp
// или sandbox (shim.sql требует ещё строже: test, sandbox или tmp). Строка
// подключения нигде не печатается.
//
// Что делает (по порядку):
//   круг 1: shim.sql (+ shim_strict_defaults.sql для режима strict) и помощники;
//           ТОЛЬКО 001_init.sql и тесты «окна» (sql/window): состояние между 001 и 002;
//           остальные миграции; тесты sql/*.test.sql; SQL-блоки из
//           docs/backend-security-checklist.md, помеченные «-- check:<id>»
//           (с временным админом, который потом удаляется);
//   круг 2: все миграции повторно (идемпотентность), снова тесты и блоки чек-листа;
//   круг 3: повторно ТОЛЬКО 001_init.sql (он не должен отнимать права, выданные 002),
//           снова тесты и блоки чек-листа;
//   круг 4: повторный сид не затирает правки админа; самопроверки миграций
//           сами останавливают файл при испорченной защите (SC-проверки).
//   Затем сверка: набор проверок в кругах 2 и 3 совпадает с кругом 1, а полный
//   набор совпадает с манифестом expected-checks.txt (потерянная или новая
//   проверка не остаётся незамеченной; обновить манифест: --update-manifest).
//
// Запуск (пример; драйвер pg ставится ВНЕ проекта, package.json не трогаем):
//   DATABASE_URL=postgres://user:pass@127.0.0.1:55432/gds_x_test \
//   GDS_PG_MODULE=/путь/к/node_modules/pg \
//   node supabase/tests/run.mjs [--variant=legacy|strict] [--no-docs] [--update-manifest]
// Код выхода: 0 все проверки прошли; 1 есть провалы; 2 неверный запуск.

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED, assertEntryHashes } from './lib/sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const SQL_DIR = path.join(HERE, 'sql');
const WINDOW_DIR = path.join(SQL_DIR, 'window');
const DOC_CHECKLIST = path.join(ROOT, 'docs', 'backend-security-checklist.md');
const MANIFEST = path.join(HERE, 'expected-checks.txt');

// Значение, без которого shim.sql и тесты не запускаются.
const ACK = 'DISPOSABLE-SANDBOX-NOT-SUPABASE';
const DOC_ADMIN_ID = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';

const require = createRequire(import.meta.url);

// Драйвер pg грузится из папки вне проекта (GDS_PG_MODULE). Перед загрузкой проверяется,
// что это действительно пакет pg закреплённой версии (список PINNED в lib/sandbox.mjs).
export function loadPg() {
  const spec = process.env.GDS_PG_MODULE || 'pg';
  if (path.isAbsolute(spec)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path.join(spec, 'package.json'), 'utf8'));
    } catch {
      throw new Error('GDS_PG_MODULE указывает не на папку пакета pg (нет package.json)');
    }
    if (pkg.name !== 'pg' || !PINNED.pg.includes(pkg.version)) {
      throw new Error(`GDS_PG_MODULE: ожидался pg ${PINNED.pg.join(' или ')}, найден ${pkg.name}@${pkg.version}`);
    }
    assertEntryHashes('pg', spec);
  }
  try {
    return require(spec);
  } catch {
    throw new Error(
      'Не найден драйвер pg. Установите его вне проекта (например, npm install --prefix <папка> --save-exact pg@8.23.1) ' +
      'и задайте GDS_PG_MODULE=<абсолютный путь>/node_modules/pg'
    );
  }
}

// Отказ, если цель не похожа на одноразовую локальную базу. Строку не печатаем.
export function assertDisposableTarget(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL не разобран');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Отказ: хост базы не локальный. Тесты запускаются только на локальной одноразовой базе.');
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/(^|[_-])(test|dev|tmp|sandbox)($|[_-])/i.test(dbName)) {
    throw new Error('Отказ: в имени базы нет отдельным словом (через _ или -) test, dev, tmp или sandbox.');
  }
}

function listSql(dir, pattern) {
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

export const migrationFiles = () => listSql(MIGRATIONS_DIR, /^\d{3}_.+\.sql$/);
export const testFiles = () => listSql(SQL_DIR, /^\d{2}_.+\.test\.sql$/);
export const windowTestFiles = () => listSql(WINDOW_DIR, /^\d{2}_.+\.test\.sql$/);

// Блоки ```sql ... ```, у которых первая непустая строка «-- check:<id>».
export function extractDocChecks(markdown) {
  const blocks = [];
  const re = /```sql\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const body = m[1];
    const first = body.split(/\r?\n/).find((line) => line.trim() !== '');
    const tag = /^--\s*check:([A-Za-z0-9_.-]+)/.exec(first ?? '');
    if (tag) blocks.push({ id: tag[1], sql: body });
  }
  return blocks;
}

export class Suite {
  constructor(client) {
    this.client = client;
    this.results = [];
    this.round = 0;
    client.on('notice', (n) => {
      const text = String(n.message ?? '');
      if (!text.startsWith('RESULT|')) return;
      const [, id, status, ...rest] = text.split('|');
      this.results.push({ round: this.round, id, status, desc: rest.join('|') });
    });
  }

  record(id, ok, desc) {
    this.results.push({ round: this.round, id, status: ok ? 'PASS' : 'FAIL', desc });
  }

  // Выполняет файл; провал записывается как проверка FILE:<имя>.
  async runFile(file) {
    const res = await this.tryFile(file);
    if (!res.ok) this.record(`FILE:${path.basename(file)}`, false, `ошибка выполнения: ${res.message}`);
    return res.ok;
  }

  // Выполняет файл и возвращает результат, ничего не записывая.
  async tryFile(file) {
    const sql = readFileSync(file, 'utf8');
    try {
      await this.client.query(sql);
    } catch (err) {
      try { await this.client.query('rollback'); } catch { /* соединение могло уже выйти из транзакции */ }
      return { ok: false, message: String(err?.message ?? err).split('\n')[0] };
    }
    return { ok: true, message: '' };
  }

  async prepare(variant) {
    await this.client.query('select set_config($1, $2, false)', ['gds.sandbox_ack', ACK]);
    // как в SQL Editor Supabase: расширения лежат в схеме extensions
    await this.client.query('set search_path to "$user", public, extensions');
    if (!(await this.runFile(path.join(HERE, 'shim.sql')))) return false;
    if (variant === 'strict' && !(await this.runFile(path.join(HERE, 'shim_strict_defaults.sql')))) return false;
    return this.runFile(path.join(SQL_DIR, '00_helpers.sql'));
  }

  async applyMigrations(files = migrationFiles()) {
    let ok = true;
    for (const file of files) {
      ok = (await this.runFile(file)) && ok;
    }
    return ok;
  }

  async runTests() {
    let ok = true;
    for (const file of testFiles()) {
      ok = (await this.runFile(file)) && ok;
    }
    return ok;
  }

  // Тесты состояния между 001 и 002.
  async runWindowTests() {
    let ok = true;
    for (const file of windowTestFiles()) {
      ok = (await this.runFile(file)) && ok;
    }
    return ok;
  }

  async runDocChecks() {
    let markdown;
    try {
      markdown = readFileSync(DOC_CHECKLIST, 'utf8');
    } catch {
      this.record('DOC:file', false, 'не найден docs/backend-security-checklist.md');
      return false;
    }
    const blocks = extractDocChecks(markdown);
    this.record('DOC:count', blocks.length > 0, `найдено SQL-проверок в чек-листе: ${blocks.length}`);

    // Временный админ, как будто владелец уже выполнил шаг «создать админа».
    await this.client.query('insert into auth.users (id, email) values ($1, $2)', [DOC_ADMIN_ID, 'doc-check-admin@example.test']);
    await this.client.query('insert into public.user_roles (id, role) values ($1, $2)', [DOC_ADMIN_ID, 'admin']);
    let ok = true;
    try {
      for (const block of blocks) {
        try {
          await this.client.query(block.sql);
          this.record(`DOC:${block.id}`, true, 'SQL из чек-листа выполнился без ошибки (все ожидания сошлись)');
        } catch (err) {
          try { await this.client.query('rollback'); } catch { /* уже вне транзакции */ }
          this.record(`DOC:${block.id}`, false, String(err?.message ?? err).split('\n')[0]);
          ok = false;
        }
      }
    } finally {
      await this.client.query('delete from auth.users where id = $1', [DOC_ADMIN_ID]);
    }
    return ok;
  }

  // Повторный запуск миграций не должен затирать правки, сделанные админом.
  async checkRerunKeepsAdminEdits() {
    const marker = 'EDITED-BY-ADMIN-MARKER';
    await this.client.query('update public.products set description = $1 where slug = $2', [marker, 'altair']);
    await this.client.query('update public.stores set phone = $1 where email = $2', ['8 800 000-00-00', 'mtechno.tobacco@gmail.com']);
    await this.applyMigrations();
    const product = await this.client.query('select description from public.products where slug = $1', ['altair']);
    const store = await this.client.query('select phone from public.stores where email = $1', ['mtechno.tobacco@gmail.com']);
    const counts = await this.client.query(
      'select (select count(*) from public.products)::int as p, (select count(*) from public.stores)::int as s, ' +
      '(select count(*) from public.brands)::int as b, (select count(*) from public.categories)::int as c'
    );
    this.record('R01', product.rows[0]?.description === marker, 'повторный запуск 004_seed.sql не затирает описание, правленное админом');
    this.record('R02', store.rows[0]?.phone === '8 800 000-00-00', 'повторный запуск не затирает правки точки продаж');
    const c = counts.rows[0];
    this.record('R03', c.p === 10 && c.s === 1 && c.b === 1 && c.c === 1,
      `повторные запуски не дублируют строки: вкусов ${c.p}, точек ${c.s}, брендов ${c.b}, категорий ${c.c}`);
  }

  // Самопроверка миграции должна остановить файл, когда защита испорчена:
  // портим состояние (setup), запускаем файл, ждём ошибку с нужным текстом,
  // чиним (cleanup) и убеждаемся, что файл снова проходит.
  async expectAbort({ id, desc, setup, file, includes, cleanup, after }) {
    await this.client.query(setup);
    let message = null;
    try {
      await this.client.query(readFileSync(file, 'utf8'));
    } catch (err) {
      message = String(err?.message ?? err);
      try { await this.client.query('rollback'); } catch { /* вне транзакции */ }
    }
    let extra = true;
    let extraText = '';
    if (after) {
      const res = await after();
      extra = res.ok;
      extraText = res.text;
    }
    await this.client.query(cleanup);
    const stopped = message !== null && message.includes(includes);
    this.record(id, stopped && extra,
      `${desc}: ${message === null ? 'файл НЕ остановился' : 'файл остановился («' + message.split('\n')[0].slice(0, 110) + '»)'}${extraText ? '; ' + extraText : ''}`);
    const again = await this.tryFile(file);
    this.record(`${id}b`, again.ok, `${desc}: после устранения причины файл снова проходит${again.ok ? '' : ' (' + again.message + ')'}`);
  }

  async checkSelfChecksFire() {
    const m002 = migrationFiles().find((f) => path.basename(f).startsWith('002_'));
    const m003 = migrationFiles().find((f) => path.basename(f).startsWith('003_'));

    await this.expectAbort({
      id: 'SC01', desc: '002: чужая публичная политика чтения на brands', file: m002, includes: 'GDS 002',
      setup: 'create policy zz_broad on public.brands for select to public using (true)',
      cleanup: 'drop policy if exists zz_broad on public.brands',
    });
    await this.expectAbort({
      id: 'SC02', desc: '002: чужая политика вставки для вошедших на products', file: m002, includes: 'GDS 002',
      setup: 'create policy zz_ins on public.products for insert to authenticated with check (true)',
      cleanup: 'drop policy if exists zz_ins on public.products',
    });
    await this.expectAbort({
      id: 'SC03', desc: '003: на storage.objects выключен RLS', file: m003, includes: 'GDS 003',
      setup: 'alter table storage.objects disable row level security',
      cleanup: 'alter table storage.objects enable row level security',
    });
    await this.expectAbort({
      id: 'SC04', desc: '003: чужая публичная политика чтения на storage.objects (часть 1 при этом применяется)', file: m003, includes: 'GDS 003',
      setup: "create policy zz_pub on storage.objects for select to anon using (bucket_id = 'product-images'); " +
             "update storage.buckets set file_size_limit = 1 where id = 'product-images'",
      cleanup: 'drop policy if exists zz_pub on storage.objects',
      after: async () => {
        const r = await this.client.query("select file_size_limit::text as lim from storage.buckets where id = 'product-images'");
        return { ok: r.rows[0]?.lim === '5242880', text: 'лимит бакета восстановлен частью 1: ' + r.rows[0]?.lim };
      },
    });
    await this.expectAbort({
      id: 'SC05', desc: '003: политика записи на storage.buckets для вошедших', file: m003, includes: 'GDS 003',
      setup: 'create policy zz_bk on storage.buckets for insert to authenticated with check (true)',
      cleanup: 'drop policy if exists zz_bk on storage.buckets',
    });
    await this.expectAbort({
      id: 'SC06', desc: '002: право INSERT у anon через членство в роли', file: m002, includes: 'GDS 002',
      setup: 'create role zz_writer nologin; grant insert on table public.products to zz_writer; ' +
             'alter role anon inherit; grant zz_writer to anon',
      cleanup: 'revoke zz_writer from anon; alter role anon noinherit; ' +
               'revoke all on table public.products from zz_writer; drop role zz_writer',
    });

    // Право на колонку у anon: повторный 002 его снимает вместе с правами на таблицу.
    await this.client.query('grant insert (name) on table public.brands to anon');
    const healed = await this.tryFile(m002);
    const left = await this.client.query("select has_any_column_privilege('anon', 'public.brands', 'INSERT') as still");
    this.record('SC07', healed.ok && left.rows[0].still === false,
      'повторный 002 снимает право на колонку, выданное anon вручную');
  }

  summary() {
    const byRound = new Map();
    for (const r of this.results) {
      const row = byRound.get(r.round) ?? { pass: 0, fail: 0 };
      if (r.status === 'PASS') row.pass += 1; else row.fail += 1;
      byRound.set(r.round, row);
    }
    const pass = this.results.filter((r) => r.status === 'PASS').length;
    const fail = this.results.length - pass;
    return { pass, fail, byRound, failed: this.results.filter((r) => r.status !== 'PASS') };
  }
}

function idsOf(results, rounds) {
  return new Set(results.filter((r) => rounds.includes(r.round) && !r.id.startsWith('FILE:')).map((r) => r.id));
}

// Сверка наборов проверок между кругами и с манифестом.
function verifyConsistency(suite, { docs, updateManifest }) {
  const base = idsOf(suite.results, [1]);
  const round2 = idsOf(suite.results, [2]);
  const round3 = idsOf(suite.results, [3]);
  const windowIds = [...base].filter((id) => id.startsWith('W'));
  const baseWithoutWindow = new Set([...base].filter((id) => !windowIds.includes(id)));
  suite.round = 5;
  // Идентификатор проверки должен быть уникален внутри круга: иначе удаление одной из двух
  // одноимённых проверок осталось бы незамеченным.
  for (const round of [1, 2, 3, 4]) {
    const counts = new Map();
    for (const r of suite.results) {
      if (r.round !== round || r.id.startsWith('FILE:')) continue;
      counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    }
    for (const [id, n] of counts) {
      if (n > 1) suite.record(`CONSISTENCY:duplicate:${id}`, false, `идентификатор проверки повторяется ${n} раза в круге ${round}`);
    }
  }
  for (const id of baseWithoutWindow) {
    if (!round2.has(id)) suite.record(`CONSISTENCY:round2-missing:${id}`, false, 'проверка есть в круге 1, но не выполнялась в круге 2');
    if (!round3.has(id)) suite.record(`CONSISTENCY:round3-missing:${id}`, false, 'проверка есть в круге 1, но не выполнялась в круге 3');
  }
  for (const id of round2) {
    if (!baseWithoutWindow.has(id)) suite.record(`CONSISTENCY:round2-extra:${id}`, false, 'проверка есть в круге 2, но её нет в круге 1');
  }

  const full = new Set([...idsOf(suite.results, [1, 4])]);
  if (!docs) for (const id of [...full]) if (id.startsWith('DOC:')) full.delete(id);
  if (updateManifest) {
    if (!docs) {
      suite.record('MANIFEST:update', false, 'манифест обновляется только при включённых проверках чек-листа (без --no-docs)');
    } else {
      writeFileSync(MANIFEST, [...full].sort().join('\n') + '\n', 'utf8');
      suite.record('MANIFEST:update', true, `манифест записан: ${full.size} проверок`);
    }
    return;
  }
  if (!existsSync(MANIFEST)) {
    suite.record('MANIFEST:missing-file', false, 'нет файла expected-checks.txt (создайте: --update-manifest)');
    return;
  }
  const expected = new Set(readFileSync(MANIFEST, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  if (!docs) for (const id of [...expected]) if (id.startsWith('DOC:')) expected.delete(id);
  for (const id of expected) {
    if (!full.has(id)) suite.record(`MANIFEST:missing:${id}`, false, 'проверка из манифеста не выполнялась (удалена или не дошла до конца)');
  }
  for (const id of full) {
    if (!expected.has(id)) suite.record(`MANIFEST:new:${id}`, false, 'новая проверка, которой нет в манифесте (обновите: --update-manifest)');
  }
}

export async function runSuite({ connectionString, variant = 'legacy', docs = true, log = console.log, pgModule, updateManifest = false }) {
  assertDisposableTarget(connectionString);
  const { Client } = pgModule ?? loadPg();
  const client = new Client({ connectionString });
  await client.connect();
  const suite = new Suite(client);
  try {
    suite.round = 0;
    if (!(await suite.prepare(variant))) return finish(suite, log, variant);
    const [first, ...rest] = migrationFiles();

    // Круг 1: сначала только 001 и проверка «окна», потом всё остальное.
    suite.round = 1;
    await suite.applyMigrations([first]);
    await suite.runWindowTests();
    await suite.applyMigrations(rest);
    await suite.runTests();
    if (docs) await suite.runDocChecks();

    // Круг 2: повторное применение всех миграций поверх готовой схемы.
    suite.round = 2;
    await suite.applyMigrations();
    await suite.runTests();
    if (docs) await suite.runDocChecks();

    // Круг 3: повторно только 001 (не должен отнимать права, выданные 002).
    suite.round = 3;
    await suite.applyMigrations([first]);
    await suite.runTests();
    if (docs) await suite.runDocChecks();

    // Круг 4: сид и самопроверки миграций.
    suite.round = 4;
    await suite.checkRerunKeepsAdminEdits();
    await suite.checkSelfChecksFire();

    verifyConsistency(suite, { docs, updateManifest });
  } finally {
    await client.end();
  }
  return finish(suite, log, variant);
}

function finish(suite, log, variant) {
  const s = suite.summary();
  for (const r of s.failed) log(`ПРОВАЛ [круг ${r.round}] ${r.id}: ${r.desc}`);
  for (const [round, row] of [...s.byRound.entries()].sort((a, b) => a[0] - b[0])) {
    log(`режим ${variant}, круг ${round}: прошло ${row.pass}, провалено ${row.fail}`);
  }
  log(`ИТОГО режим ${variant}: прошло ${s.pass}, провалено ${s.fail}`);
  return { ...s, results: suite.results };
}

// Точка входа командной строки.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const variantArg = args.find((a) => a.startsWith('--variant='));
  const variant = variantArg ? variantArg.split('=')[1] : 'legacy';
  const docs = !args.includes('--no-docs');
  const updateManifest = args.includes('--update-manifest');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Не задан DATABASE_URL (одноразовая локальная база с test, dev, tmp или sandbox в имени).');
    process.exit(2);
  }
  if (!['legacy', 'strict'].includes(variant)) {
    console.error('Неизвестный режим: используйте --variant=legacy или --variant=strict.');
    process.exit(2);
  }
  try {
    const result = await runSuite({ connectionString, variant, docs, updateManifest });
    process.exit(result.fail === 0 && result.pass > 0 ? 0 : 1);
  } catch (err) {
    console.error(String(err?.message ?? err).split('\n')[0]);
    process.exit(2);
  }
}

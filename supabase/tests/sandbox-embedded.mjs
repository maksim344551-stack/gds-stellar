// supabase/tests/sandbox-embedded.mjs
// Поднимает ОДНОРАЗОВЫЙ PostgreSQL без Docker (пакет embedded-postgres), прогоняет
// supabase/tests/run.mjs в обоих режимах прав платформы и удаляет данные.
//
// Пакеты ставятся ВНЕ проекта (package.json проекта не меняется), версии закрепляются
// (проверяются в lib/sandbox.mjs):
//   npm install --prefix <папка> --save-exact --ignore-scripts \
//     embedded-postgres@17.10.0-beta.17 @embedded-postgres/windows-x64@17.10.0-beta.17 pg@8.23.1
// (на другой ОС замените пакет @embedded-postgres/windows-x64 на подходящий,
//  версию основного и платформенного пакета держите одинаковой; для PostgreSQL 15
//  используйте 15.18.0-beta.17).
//
// Запуск:
//   GDS_SANDBOX_PREFIX=<папка> node supabase/tests/sandbox-embedded.mjs \
//     [--variants=legacy,strict] [--no-docs] [--update-manifest] [--locale="English_United States.1252"]
//
// Что гарантируется: кластер слушает только 127.0.0.1 на свободном порту, пароль
// случайный и нигде не печатается, база называется gds_sandbox_<режим>_test, данные
// лежат во временной папке и удаляются при остановке. Существующие .env не читаются.
// Код выхода: 0 всё прошло; 1 есть провалы; 2 сбой запуска.

import { startSandbox } from './lib/sandbox.mjs';

const args = process.argv.slice(2);
const prefix = process.env.GDS_SANDBOX_PREFIX;
if (!prefix) {
  console.error('Не задан GDS_SANDBOX_PREFIX: папка, где установлены embedded-postgres и pg (см. комментарий в начале файла).');
  process.exit(2);
}
const argValue = (name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const variants = (argValue('--variants') ?? 'legacy,strict').split(',');
const locale = argValue('--locale') ?? 'C';
const docs = !args.includes('--no-docs');
const updateManifest = args.includes('--update-manifest');

let exitCode = 0;
let sandbox;
try {
  sandbox = await startSandbox({ prefix, locale });
  const { runSuite } = await import('./run.mjs');
  console.log(`PostgreSQL ${sandbox.serverVersion}, локаль «${sandbox.locale}» (одноразовый кластер, порт выбран автоматически); ` +
    `embedded-postgres ${sandbox.versions['embedded-postgres']}, pg ${sandbox.versions.pg}`);

  for (const variant of variants) {
    const dbName = `gds_sandbox_${variant}_test`;
    await sandbox.createDatabase(dbName);
    // DATABASE_URL в окружении процесса; не печатается.
    process.env.DATABASE_URL = sandbox.urlFor(dbName);
    const result = await runSuite({ connectionString: process.env.DATABASE_URL, variant, docs, updateManifest });
    if (result.fail > 0 || result.pass === 0) exitCode = 1;
  }
} catch (err) {
  console.error('Сбой запуска песочницы:', String(err?.message ?? err).split('\n')[0]);
  exitCode = 2;
} finally {
  delete process.env.DATABASE_URL;
  if (sandbox) await sandbox.stop();
}
process.exit(exitCode);

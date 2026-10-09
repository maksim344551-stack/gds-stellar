// supabase/tests/lib/sandbox.mjs
// Общий помощник: поднимает ОДНОРАЗОВЫЙ PostgreSQL без Docker (пакет embedded-postgres).
// Используется sandbox-embedded.mjs и mutations.mjs. Не для боевой базы.
//
// Откуда берётся код: из папки GDS_SANDBOX_PREFIX (пакеты ставятся ВНЕ проекта).
// Перед загрузкой проверяются имя и версия каждого пакета и sha256 двух входных файлов
// (ENTRY_HASHES): это защищает от случайной замены пакета и грубой подмены, но НЕ от
// целенаправленной правки остальных файлов пакета. Поэтому папка должна быть доверенной:
// создана вами командой npm install из README с --ignore-scripts, без чужих пакетов.
// Чтобы разрешить другую версию, осознанно добавьте её в PINNED и обновите хеши.

import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PINNED = {
  pg: ['8.23.1'],
  'embedded-postgres': ['17.10.0-beta.17', '15.18.0-beta.17'],
};

// sha256 входных файлов пакетов (у обеих закреплённых версий embedded-postgres код совпадает,
// различаются только бинарники PostgreSQL в платформенном пакете).
export const ENTRY_HASHES = {
  pg: {
    'lib/index.js': '3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c',
    'lib/client.js': 'ad6aa93c26b0bf26db1f2ebe74216212790a04c41af5585c63760f9fa8322a32',
  },
  'embedded-postgres': {
    'dist/index.js': 'bf0e5908e56276c31d4e588785d5349427ba076dcd1e0d8ed4945c8ce3576c4e',
    'dist/binary.js': 'f77a04f667045a3b1912297ea6f9d94b75b38e3112f78296b384d41f161c7be3',
  },
};

function readPackage(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    throw new Error(`Нет package.json в ${path.basename(dir)}: пакет не установлен в GDS_SANDBOX_PREFIX`);
  }
}

// Сверяет sha256 входных файлов пакета name в папке dir.
export function assertEntryHashes(name, dir) {
  for (const [file, expected] of Object.entries(ENTRY_HASHES[name] ?? {})) {
    let actual;
    try {
      actual = createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex');
    } catch {
      throw new Error(`Пакет ${name}: нет файла ${file}`);
    }
    if (actual !== expected) {
      throw new Error(`Пакет ${name}: файл ${file} не совпадает с закреплённым хешем; не выполняю. Если вы сознательно обновили версию, обновите ENTRY_HASHES`);
    }
  }
}

// Проверяет пакеты в <prefix>/node_modules и возвращает их версии.
export function assertPinnedPackages(prefix) {
  if (!path.isAbsolute(prefix)) throw new Error('GDS_SANDBOX_PREFIX должен быть абсолютным путём');
  const modules = path.join(prefix, 'node_modules');
  const versions = {};
  for (const [name, allowed] of Object.entries(PINNED)) {
    const pkg = readPackage(path.join(modules, name));
    if (pkg.name !== name) throw new Error(`Пакет ${name}: в package.json другое имя (${pkg.name})`);
    if (!allowed.includes(pkg.version)) {
      throw new Error(`Пакет ${name}@${pkg.version} не из закреплённого списка (${allowed.join(', ')}); обновите PINNED в supabase/tests/lib/sandbox.mjs осознанно`);
    }
    versions[name] = pkg.version;
    assertEntryHashes(name, path.join(modules, name));
  }
  // Платформенные бинарники должны быть той же версии, что и основной пакет.
  const scope = path.join(modules, '@embedded-postgres');
  let platformPackages = [];
  try { platformPackages = readdirSync(scope); } catch { /* нет платформенных пакетов */ }
  if (platformPackages.length === 0) throw new Error('Не установлен ни один пакет @embedded-postgres/<платформа>');
  for (const name of platformPackages) {
    const pkg = readPackage(path.join(scope, name));
    if (pkg.version !== versions['embedded-postgres']) {
      throw new Error(`@embedded-postgres/${name}@${pkg.version} не совпадает с embedded-postgres@${versions['embedded-postgres']}`);
    }
  }
  return versions;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Запускает кластер. Возвращает объект с методами createDatabase, urlFor, stop.
// locale: 'C' (по умолчанию) или имя локали ОС, например 'English_United States.1252' на Windows
// (ближайший аналог en_US.UTF-8; кодировка базы всегда UTF8).
export async function startSandbox({ prefix, locale = 'C' }) {
  const versions = assertPinnedPackages(prefix);
  const modules = path.join(prefix, 'node_modules');
  process.env.GDS_PG_MODULE = path.join(modules, 'pg');

  const embeddedUrl = pathToFileURL(path.join(modules, 'embedded-postgres', 'dist', 'index.js')).href;
  const EmbeddedPostgres = (await import(embeddedUrl)).default;

  const port = await freePort();
  const password = randomBytes(18).toString('hex');
  const server = new EmbeddedPostgres({
    databaseDir: mkdtempSync(path.join(os.tmpdir(), 'gds-pg-test-')),
    port,
    user: 'postgres',
    password,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', `--locale=${locale}`],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();

  const probe = server.getPgClient('postgres', '127.0.0.1');
  await probe.connect();
  const version = (await probe.query('show server_version')).rows[0].server_version;
  const collate = (await probe.query("select datcollate from pg_database where datname = 'postgres'")).rows[0].datcollate;
  await probe.end();

  return {
    versions,
    serverVersion: version,
    locale: collate,
    createDatabase: (name) => server.createDatabase(name),
    // Строка подключения собирается в памяти и нигде не печатается.
    urlFor: (dbName) => `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`,
    stop: () => server.stop(),
  };
}

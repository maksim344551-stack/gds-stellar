// Публикация на statichost.eu: собирает проект, пакует dist в zip и отправляет в /drop.
// Тот же запрос делает официальный shcli. Ключ и имя сайта берутся только из переменных окружения:
//   $env:STATICHOST_SITE = 'имя-сайта'; $env:STATICHOST_APIKEY = '...'; npm run deploy:statichost
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const site = process.env.STATICHOST_SITE ?? '';
const key = process.env.STATICHOST_APIKEY ?? '';
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site) || !key) {
  console.error('Задайте STATICHOST_SITE (латиница, цифры, дефис) и STATICHOST_APIKEY.');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const zip = resolve(root, 'site.zip');

console.log('→ сборка');
await build({ root, logLevel: 'warn' });

console.log('→ упаковка dist');
// tar (bsdtar в Windows 10+ и macOS) умеет писать zip; аргументы — массивом, без shell
execFileSync('tar', ['-a', '-c', '-f', zip, '-C', dist, '.']);

console.log(`→ отправка в ${site}`);
try {
  const res = await fetch(`https://builder.statichost.eu/${site}/drop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/zip', Accept: 'text/plain' },
    body: readFileSync(zip),
    signal: AbortSignal.timeout(600_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`statichost вернул ${res.status}: ${text.slice(0, 400)}`);
  console.log(text.trim() || 'готово');
} finally {
  rmSync(zip, { force: true });
}

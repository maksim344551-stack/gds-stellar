// Бюджет веса сайта. Запускается после `npm run build` и роняет проверку, если сборка стала тяжелее порога.
// Цифры взяты с запасом около 20% от текущего состояния: превышение значит, что в сайт попало что-то тяжёлое, и это стоит заметить сразу.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'dist');
const KB = 1024;
const LIMITS = {
  jsGzip: 200 * KB, // основной скрипт (three.js и код сайта) в сжатом виде
  css: 40 * KB,
  oneImage: 260 * KB, // любая одна картинка
  planetsPhone: 1.1 * 1024 * KB, // все облегчённые планеты (для телефонов)
  total: 4.2 * 1024 * KB, // всё содержимое dist
};

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ p, name, size: statSync(p).size, ext: extname(name).toLowerCase() });
  }
})(dist);

const problems = [];
const fmt = (n) => `${(n / KB).toFixed(0)} КБ`;
const check = (label, value, limit) => {
  const ok = value <= limit;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}: ${fmt(value)} (порог ${fmt(limit)})`);
  if (!ok) problems.push(label);
};

const js = files.filter((f) => f.ext === '.js');
const mainJs = js.sort((a, b) => b.size - a.size)[0];
check('основной скрипт, gzip', gzipSync(readFileSync(mainJs.p)).length, LIMITS.jsGzip);
check('стили', files.filter((f) => f.ext === '.css').reduce((s, f) => s + f.size, 0), LIMITS.css);
const images = files.filter((f) => ['.webp', '.jpg', '.jpeg', '.png'].includes(f.ext));
const biggest = images.sort((a, b) => b.size - a.size)[0];
check(`самая тяжёлая картинка (${biggest.name})`, biggest.size, LIMITS.oneImage);
// облегчённые планеты отличаются от полных размером: берём 11 самых лёгких файлов вида pNN-*.webp
const planets = files.filter((f) => /^p\d\d-.*\.webp$/.test(f.name)).sort((a, b) => a.size - b.size);
check('облегчённые планеты (11 файлов)', planets.slice(0, 11).reduce((s, f) => s + f.size, 0), LIMITS.planetsPhone);
check('весь dist', files.reduce((s, f) => s + f.size, 0), LIMITS.total);

if (problems.length) {
  console.error(`\nБюджет веса превышен: ${problems.join(', ')}`);
  process.exit(1);
}

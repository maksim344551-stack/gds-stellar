// Перед публикацией: настоящая политика конфиденциальности должна быть опубликована и без незаполненных мест.
// node scripts/check-privacy.mjs [файл]   (по умолчанию public/privacy.html; код выхода 1, если ещё не готово)
// Черновик с пометками хранится локально в docs/privacy-draft.html: node scripts/check-privacy.mjs docs/privacy-draft.html
import fs from 'node:fs';

const target = process.argv[2] ?? 'public/privacy.html';
const html = fs.readFileSync(new URL(`../${target}`, import.meta.url), 'utf8');

if (/<meta name="gds-privacy-status" content="stub"/.test(html)) {
  console.log(`${target}: это заглушка, настоящая политика ещё не опубликована`);
  process.exitCode = 1;
} else {
  const todos = [...html.matchAll(/<mark class="todo">([^<]*)<\/mark>/g)].map((m) => m[1]);
  if (todos.length === 0) {
    console.log(`${target}: незаполненных мест нет`);
  } else {
    console.log(`${target}: осталось незаполненных мест: ${todos.length}`);
    todos.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    process.exitCode = 1;
  }
}

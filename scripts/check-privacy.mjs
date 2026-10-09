// Перед публикацией: в политике конфиденциальности не должно остаться незаполненных мест.
// node scripts/check-privacy.mjs  (код выхода 1, если что-то осталось)
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
const todos = [...html.matchAll(/<mark class="todo">([^<]*)<\/mark>/g)].map((m) => m[1]);
if (todos.length === 0) {
  console.log('privacy.html: незаполненных мест нет');
} else {
  console.log(`privacy.html: осталось незаполненных мест: ${todos.length}`);
  todos.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  process.exitCode = 1;
}

// Общие помощники проверок. Сцена на слабой машине рисуется медленно (около кадра в секунду), поэтому ожидания щедрые,
// а в адрес добавляются ?q=2 (полная сцена без автоподбора качества) и dtmax=1 (шаг анимации не ограничен кадром).

/** Открывает сайт, ждёт конца заставки и возвращает список ошибок консоли. Возрастной экран пропускается, если age=false не задан. */
export async function open(page, { query = '?q=2&dtmax=1', age = true } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (age) await page.addInitScript(() => { try { sessionStorage.setItem('gds-18', '1'); } catch { /* приватный режим */ } });
  await page.goto(`/${query}`);
  await page.waitForFunction(() => !document.querySelector('#loader'), null, { timeout: 150_000 });
  await page.waitForTimeout(1500);
  return errors;
}

/** Размеры блоков страницы (есть только в режиме разработки). */
export const layout = (page) => page.evaluate(() => window.__gds.L());

/** Режим сайта: «3d» или «fallback» (версия без 3D). */
export const mode = (page) => page.evaluate(() => (document.documentElement.classList.contains('no-webgl') ? 'fallback' : '3d'));

/** Горизонтальная прокрутка страницы: на сайте её быть не должно. */
export const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

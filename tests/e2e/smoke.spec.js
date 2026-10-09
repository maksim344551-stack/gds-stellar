import { test, expect } from '@playwright/test';
import { open, layout, overflowX } from './helpers.js';

test('страница открывается без ошибок и без горизонтальной прокрутки', async ({ page }) => {
  const errors = await open(page);
  expect(await page.locator('h1').count()).toBe(1);
  await expect(page.locator('h1')).toContainText('Discover');
  const L = await layout(page);
  for (const y of [0, L.prodTop, L.flavTop + L.vh * 0.1, L.blendTop, L.partnersTop, L.contactTop, L.docH]) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(500);
    expect(await overflowX(page), `горизонтальная прокрутка на высоте ${Math.round(y)}`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('у кнопок и полей есть имена, язык страницы задан', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input:not([type=hidden]), textarea')]
    .filter((e) => {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const name = e.getAttribute('aria-label') || e.textContent.trim() || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label') || e.getAttribute('title');
      return !name;
    })
    .map((e) => `${e.tagName}#${e.id}.${e.className}`));
  expect(unnamed).toEqual([]);
});

test('в видимом тексте нет тире и декоративных точек', async ({ page }) => {
  await open(page);
  const bad = await page.evaluate(() => (document.body.innerText.match(/[—–·●✦]/g) || []).length);
  expect(bad).toBe(0);
});

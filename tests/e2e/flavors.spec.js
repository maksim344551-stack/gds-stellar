import { test, expect } from '@playwright/test';
import { open, layout } from './helpers.js';

async function toFlavors(page) {
  const L = await layout(page);
  await page.evaluate((y) => window.scrollTo(0, y), L.flavTop + L.vh * 0.1);
  await page.waitForTimeout(2500);
}

test('вкус выбирается стрелками и клавишами, по кругу', async ({ page }) => {
  const errors = await open(page);
  await toFlavors(page);
  const idx = page.locator('#f-idx');
  await expect(idx).toHaveText('01');
  const accent1 = await page.evaluate(() => document.documentElement.style.getPropertyValue('--fa'));
  await page.locator('#f-next').click();
  await expect(idx).toHaveText('02');
  await expect(page.locator('#f-name')).toHaveText('Betelgeuse');
  const accent2 = await page.evaluate(() => document.documentElement.style.getPropertyValue('--fa'));
  expect(accent2).not.toBe(accent1); // цвет вкуса сменился
  await page.locator('#f-next').click();
  await expect(idx).toHaveText('03');
  await page.locator('#f-prev').click();
  await expect(idx).toHaveText('02');
  await page.keyboard.press('ArrowRight');
  await expect(idx).toHaveText('03');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(idx).toHaveText('01');
  await page.locator('#f-prev').click(); // с первого на последний
  await expect(idx).toHaveText('10');
  await page.locator('#f-next').click(); // и обратно
  await expect(idx).toHaveText('01');
  expect(errors).toEqual([]);
});

test('прокрутка вкус не меняет', async ({ page }) => {
  await open(page);
  await toFlavors(page);
  for (let i = 0; i < 4; i++) await page.locator('#f-next').click();
  await expect(page.locator('#f-idx')).toHaveText('05');
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(1500);
  await expect(page.locator('#f-idx')).toHaveText('05');
});

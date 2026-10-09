import { test, expect } from '@playwright/test';
import { open, layout } from './helpers.js';

async function toFlavors(page) {
  const L = await layout(page);
  await page.evaluate((y) => window.scrollTo(0, y), L.flavTop + L.vh * 0.1);
  await page.waitForTimeout(2500);
}

test('вкус выбирается нажатием, стрелками и клавишами', async ({ page }) => {
  const errors = await open(page);
  await toFlavors(page);
  await expect(page.locator('#f-idx')).toHaveText('01');
  await page.locator('#f-list li:nth-child(9) button').click();
  await expect(page.locator('#f-idx')).toHaveText('09');
  await expect(page.locator('#f-name')).toHaveText('Mira');
  const accent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--fa'));
  expect(accent.length).toBeGreaterThan(3);
  await page.locator('#f-next').click();
  await expect(page.locator('#f-idx')).toHaveText('10');
  await page.locator('#f-next').click();
  await expect(page.locator('#f-idx')).toHaveText('01'); // по кругу
  await page.locator('#f-prev').click();
  await expect(page.locator('#f-idx')).toHaveText('10');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#f-idx')).toHaveText('09');
  expect(errors).toEqual([]);
});

test('прокрутка вкус не меняет', async ({ page }) => {
  await open(page);
  await toFlavors(page);
  await page.locator('#f-list li:nth-child(5) button').click();
  await expect(page.locator('#f-idx')).toHaveText('05');
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(1500);
  await expect(page.locator('#f-idx')).toHaveText('05');
});

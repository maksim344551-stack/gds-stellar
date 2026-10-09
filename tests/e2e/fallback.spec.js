import { test, expect } from '@playwright/test';
import { open, layout, mode, overflowX } from './helpers.js';

test('версия без 3D: сайт читается, меню и выбор вкуса работают', async ({ page }) => {
  const errors = await open(page, { query: '?nogl=1' });
  expect(await mode(page)).toBe('fallback');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#gl')).toBeHidden();
  const L = await layout(page);
  expect(await overflowX(page)).toBeLessThanOrEqual(1);
  // фон-картинка выбрана для первого экрана
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.fb-l')].some((e) => e.classList.contains('on') && e.style.backgroundImage.includes('url')))).toBe(true);
  await page.evaluate((y) => window.scrollTo(0, y), L.flavTop + L.vh * 0.1);
  await page.waitForTimeout(1500);
  await page.locator('#f-list li:nth-child(4) button').click();
  await expect(page.locator('#f-idx')).toHaveText('04');
  await expect(page.locator('#f-name')).toHaveText('Naos');
  await page.evaluate((y) => window.scrollTo(0, y), L.contactTop);
  await page.waitForTimeout(800);
  await expect(page.locator('#lead-form')).toBeVisible();
  expect(errors).toEqual([]);
});

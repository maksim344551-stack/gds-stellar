import { test, expect } from '@playwright/test';
import { open } from './helpers.js';

test('возрастной экран: отказ закрывает сайт, согласие открывает и запоминается', async ({ page }) => {
  await open(page, { age: false });
  await expect(page.locator('#gate')).toBeVisible({ timeout: 30_000 });
  await page.locator('#gate-no').click();
  await expect(page.locator('#gate-deny')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains('is-locked'))).toBe(true);
  await page.locator('#gate-yes').click();
  await expect(page.locator('#gate')).toBeHidden({ timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.classList.contains('is-locked'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('gds-18'))).toBe('1');
});

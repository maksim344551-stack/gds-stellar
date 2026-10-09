import { test, expect } from '@playwright/test';
import { open, layout } from './helpers.js';

test.skip(({ isMobile }) => !isMobile, 'только для телефонов');

test('меню: открывается, блокирует прокрутку, закрывается, ведёт к разделам', async ({ page }) => {
  const errors = await open(page);
  const toggle = page.locator('#nav-toggle');
  await expect(toggle).toBeVisible();
  await toggle.tap();
  await expect(page.locator('#nav')).toHaveClass(/open/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(page.locator('#nav')).not.toHaveClass(/open/);

  const L = await layout(page);
  for (const [sec, key] of [['flavors', 'flavTop'], ['blend', 'blendTop'], ['contact', 'contactTop']]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await toggle.tap();
    await page.locator(`.nav-links a[data-sec="${sec}"]`).tap();
    await page.waitForTimeout(3500);
    const y = await page.evaluate(() => window.scrollY);
    expect(Math.abs(y - L[key]), `пункт ${sec}: прокрутка ${y}, цель ${L[key]}`).toBeLessThan(L.vh * 0.25);
  }
  expect(errors).toEqual([]);
});

test('шапка прячется при прокрутке вниз и возвращается при прокрутке вверх', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(1200);
  await expect(page.locator('#nav')).toHaveClass(/away/);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(1200);
  await expect(page.locator('#nav')).not.toHaveClass(/away/);
});

test('длинное описание вкуса сворачивается, а кнопка «Подробнее» показывает его целиком', async ({ page }) => {
  await open(page);
  const L = await layout(page);
  await page.evaluate((y) => window.scrollTo(0, y), L.flavTop + L.vh * 0.1);
  await page.waitForTimeout(2500);
  // описания вкусов могут меняться, поэтому длинный текст подставляется искусственно
  await page.evaluate(() => {
    document.querySelector('#f-desc').textContent = Array(24).fill('Длинное описание вкуса для проверки сворачивания.').join(' ');
    window.dispatchEvent(new Event('resize'));
  });
  const more = page.locator('#f-more');
  await expect(more).toBeVisible({ timeout: 10_000 });
  const cutBefore = await page.evaluate(() => { const d = document.querySelector('#f-desc'); return d.scrollHeight > d.clientHeight + 2; });
  expect(cutBefore).toBe(true);
  await more.tap();
  await expect(page.locator('.f-panel')).toHaveClass(/open/);
  const cutAfter = await page.evaluate(() => { const d = document.querySelector('#f-desc'); return d.scrollHeight > d.clientHeight + 2; });
  expect(cutAfter).toBe(false);
  await more.tap();
  await expect(page.locator('.f-panel')).not.toHaveClass(/open/);
});

test('зоны нажатия основных кнопок не меньше 44 px', async ({ page }) => {
  await open(page);
  const small = await page.evaluate(() => [...document.querySelectorAll('.nav-toggle, .nav-cta, .btn, .ic-btn')]
    .filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0) // скрытые (например, в закрытом возрастном экране) не считаются
    .map((e) => { const r = e.getBoundingClientRect(); return { n: e.className, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w < 43 || r.h < 43));
  expect(small).toEqual([]);
});

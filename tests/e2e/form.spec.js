import { test, expect } from '@playwright/test';
import { open } from './helpers.js';

// Проверяется только проверка полей. Способ отправки заявки (письмо, сервер) может меняться и здесь не закрепляется.
test('форма: пустая отправка показывает три ошибки и ставит фокус на первое поле', async ({ page }) => {
  await open(page);
  await page.locator('#lead-form').scrollIntoViewIfNeeded();
  await page.locator('#lead-form button[type=submit]').click();
  await expect(page.locator('#e-name')).toHaveText('Укажите имя');
  await expect(page.locator('#e-contact')).not.toBeEmpty();
  await expect(page.locator('#e-consent')).not.toBeEmpty();
  await expect(page.locator('#f-name-in')).toBeFocused();
  await page.locator('#f-name-in').fill('Иван');
  await expect(page.locator('#e-name')).toBeEmpty();
});

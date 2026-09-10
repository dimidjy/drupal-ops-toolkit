import { expect, test } from '@playwright/test';

test.describe('pages', () => {
  test('home has a heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Home');
  });

  test('about mentions the shop', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('h1')).toHaveText('About the shop');
  });
});

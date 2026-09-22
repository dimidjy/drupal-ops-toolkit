import { expect, test } from '@playwright/test';

test.describe('home page', () => {
  test('renders without PHP or JavaScript errors', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('body')).not.toContainText(
      'The website encountered an unexpected error',
    );
    expect(errors).toEqual([]);
  });
});

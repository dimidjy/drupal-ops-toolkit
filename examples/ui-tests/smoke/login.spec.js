import { expect, test } from '@playwright/test';

test.describe('login', () => {
  test('shows the form and rejects wrong credentials', async ({ page }) => {
    await page.goto('/user/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    // A random name keeps Drupal's per-user flood control out of the way.
    await page.locator('#edit-name').fill(`smoke-${Date.now()}`);
    await page.locator('#edit-pass').fill('not-the-password');
    await page.locator('#edit-submit').click();

    await expect(page.getByText('Unrecognized username or password')).toBeVisible();
  });
});
